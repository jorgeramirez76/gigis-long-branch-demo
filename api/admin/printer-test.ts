import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../lib/adminAuth.js";
import {
  createPrinterTestOrder,
  deleteCloverOrder,
  getOrderSummary,
  listCloverDevices,
  orderLineItemsPrinted,
  printOnDevice,
} from "../lib/clover.js";

/**
 * Which print routes actually land paper?
 *
 * Built for the 2026-08-27 outage: the one device every web ticket routes to
 * (CLOVER_PRINT_DEVICE_IDS) started answering FAILED mid-service, and nobody could
 * say which OTHER route still worked without standing at the register. Clover's
 * print API cannot target a printer — only a device, which relays to whatever
 * order printer that device is configured with — so this fires one $0 test ticket,
 * labeled with the route it took, at EVERY device plus Clover's default routing.
 * Staff read the labels off whatever paper comes out; that is the test result.
 *
 * POST {}                        → run the test; returns per-route states + the test order ids.
 * POST { status: ["id", ...] }   → did each ticket actually print? Reads Clover's own
 *                                  per-line `printed` stamp — the same evidence the print
 *                                  sweep trusts — so nobody has to relay it verbally.
 * POST { cleanup: ["id", ...] }  → delete those test orders from the register. Refuses any
 *                                  order whose title is not "PRINTER TEST — …", so this can
 *                                  never delete a real ticket. Run it only after the paper
 *                                  has settled — Clover's queue here runs minutes, and
 *                                  deleting an order can strand its undelivered print job.
 *
 * SAFETY: never charges, never touches web_orders. The only artifacts are the $0
 * PRINTER TEST orders, visible in the POS by design until cleaned up.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireAdmin(req, res))) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const statusIds = (req.body ?? {})?.status;
  if (Array.isArray(statusIds)) {
    const results: { orderId: string; title: string | null; printed: boolean | null; error?: string }[] = [];
    for (const raw of statusIds.slice(0, 20)) {
      const orderId = String(raw).trim();
      if (!orderId) continue;
      try {
        const summary = await getOrderSummary(orderId);
        const printed = await orderLineItemsPrinted(orderId);
        results.push({ orderId, title: summary.title ?? null, printed });
      } catch (err) {
        results.push({ orderId, title: null, printed: null, error: err instanceof Error ? err.message : "lookup failed" });
      }
    }
    res.status(200).json({
      ok: true,
      status: results,
      note: "printed true = a ticket for this order came off a printer; false = no evidence yet (still queued, or the route is dead); null = Clover unreachable, ask again.",
    });
    return;
  }

  const cleanup = (req.body ?? {})?.cleanup;
  if (Array.isArray(cleanup)) {
    const results: { orderId: string; deleted: boolean; reason?: string }[] = [];
    for (const raw of cleanup.slice(0, 20)) {
      const orderId = String(raw).trim();
      if (!orderId) continue;
      try {
        const summary = await getOrderSummary(orderId);
        if (!summary.title?.startsWith("PRINTER TEST")) {
          results.push({ orderId, deleted: false, reason: `not a test order (title: ${summary.title ?? "none"})` });
          continue;
        }
        await deleteCloverOrder(orderId);
        results.push({ orderId, deleted: true });
      } catch (err) {
        results.push({ orderId, deleted: false, reason: err instanceof Error ? err.message : "lookup/delete failed" });
      }
    }
    res.status(200).json({ ok: true, cleaned: results });
    return;
  }

  // The route every web ticket currently takes — flagged so the paper trail shows
  // whether the configured device is the broken one.
  const configured = new Set(
    (process.env.CLOVER_PRINT_DEVICE_IDS ?? "")
      .split(",")
      .map((s) => s.trim().replace(/-/g, "").toUpperCase())
      .filter(Boolean),
  );

  let devices: Awaited<ReturnType<typeof listCloverDevices>>;
  try {
    devices = await listCloverDevices();
  } catch (err) {
    res.status(502).json({ error: "devices_unreachable", message: err instanceof Error ? err.message : "could not list devices" });
    return;
  }

  const targets: { label: string; deviceId?: string; currentWebRoute: boolean }[] = devices.map((d) => {
    const label = (d.name || `${d.model ?? "DEVICE"}-${(d.serial ?? d.id).slice(-4)}`).toUpperCase();
    return {
      label,
      deviceId: d.id,
      currentWebRoute: configured.has(d.id.replace(/-/g, "").toUpperCase()),
    };
  });
  // Clover's own default order-printer routing — what the site would use with no
  // CLOVER_PRINT_DEVICE_IDS at all.
  targets.push({ label: "DEFAULT ROUTE", currentWebRoute: false });

  // Sequential on purpose: ~4 Clover calls per route, and firing them all in
  // parallel is exactly the burst that trips Clover's rate limit mid-service.
  const results: {
    label: string;
    deviceId: string | null;
    currentWebRoute: boolean;
    orderId: string | null;
    eventId: string | null;
    state: string | null;
    error: string | null;
  }[] = [];
  for (const t of targets) {
    let orderId: string | null = null;
    let printed: { eventId?: string; state?: string; error?: string };
    try {
      orderId = (await createPrinterTestOrder(t.label)).id;
      printed = await printOnDevice(orderId, t.deviceId);
    } catch (err) {
      printed = { error: err instanceof Error ? err.message : "test order failed" };
    }
    console.log(`[printer-test] ${t.label}${t.currentWebRoute ? " (current web route)" : ""} → state ${printed.state ?? "?"}${printed.error ? ` (${printed.error})` : ""} order ${orderId ?? "—"}`);
    results.push({
      label: t.label,
      deviceId: t.deviceId ?? null,
      currentWebRoute: t.currentWebRoute,
      orderId,
      eventId: printed.eventId ?? null,
      state: printed.state ?? null,
      error: printed.error ?? null,
    });
  }

  res.status(200).json({
    ok: true,
    results,
    testOrderIds: results.map((r) => r.orderId).filter(Boolean),
    note:
      "FAILED = that route's printer is down. CREATED/PRINTING = job accepted, still moving — " +
      "the labels on whatever paper comes out are the real verdict. Clean up with " +
      '{ "cleanup": [<testOrderIds>] } once staff have read the labels.',
  });
}
