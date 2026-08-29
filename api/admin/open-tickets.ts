import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../lib/adminAuth.js";
import { getOrderSummary, listOpenWebsiteOrders } from "../lib/clover.js";
import { getCaptureByCloverId, listWorklistCandidates } from "../lib/orderStore.js";

/**
 * GET — read-only reconciliation worklist for open website tickets (ported from Sea Bright).
 *
 * An open website ticket is one of TWO OPPOSITE things, and treating them alike loses money
 * in one direction or the other:
 *   - a split card order: paid ONLINE, standalone charge — ringing it up bills the customer
 *     twice and double-counts the sale (and sales tax);
 *   - an ordinary pay-at-counter order: nothing captured — it is OWED money.
 * The only reliable discriminator is whether our ledger holds a charge id for it.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireAdmin(req, res))) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  try {
    const { orders, scanned, truncated } = await listOpenWebsiteOrders();
    // SECOND NET: the scan is a window over EVERY order the shop rang up — Brandon Casella's
    // 7/26 stranded split sat outside it by late August. Our ledger knows every Clover id we
    // created; candidates the scan missed are checked individually, at any age.
    const seen = new Set(orders.map((o) => o.id));
    const candidates = (await listWorklistCandidates()).filter((c) => !seen.has(c.cloverOrderId)).slice(0, 30);
    for (const c of candidates) {
      try {
        const sum = await getOrderSummary(c.cloverOrderId);
        if (
          String(sum.state ?? "").toLowerCase() === "open" &&
          typeof sum.title === "string" &&
          /^WEBSITE(\s+ORDER)?\s+[•·]/i.test(sum.title)
        ) {
          orders.push({ id: sum.id, title: sum.title, state: sum.state, total: sum.total, paymentCount: sum.paymentCount, createdTime: sum.createdTime, note: sum.note });
        }
      } catch {
        // A candidate Clover no longer has (deleted ticket) is not an open ticket.
      }
    }
    const money = (c?: number) => (typeof c === "number" ? `$${(c / 100).toFixed(2)}` : null);
    let ledgerDegraded = false;
    const open = await Promise.all(
      orders.map(async (o) => {
        let capture: Awaited<ReturnType<typeof getCaptureByCloverId>> = null;
        let ledgerUnknown = false;
        try {
          capture = await getCaptureByCloverId(o.id);
        } catch {
          // Ledger unreachable for this row: it must land in NEITHER bucket — "owed money"
          // requires a positive answer of no charge, or a blip sends staff to double-charge.
          ledgerUnknown = true;
          ledgerDegraded = true;
        }
        // Card tips ride on the payment and are deliberately absent from the ticket; counter
        // tips are a line item on it. Compare accordingly or tipped tickets read as mismatches.
        const expectedTicket =
          capture == null ? null : capture.paymentMethod === "card" ? capture.total - capture.tip : capture.total;
        return {
          orderId: o.id,
          title: o.title ?? null,
          ticketTotal: money(o.total),
          ourTotal: capture ? money(capture.total) : null,
          totalsAgree: capture != null && typeof o.total === "number" && expectedTicket === o.total,
          payments: o.paymentCount,
          chargeId: capture?.chargeId ?? null,
          customer: capture?.customerName ?? null,
          ourStatus: capture?.status ?? null,
          createdAt: o.createdTime ? new Date(o.createdTime).toISOString() : null,
          ledgerUnknown,
          doNotRingUp: o.paymentCount === 0 && !!capture?.chargeId,
        };
      }),
    );
    const alreadyPaid = open.filter((o) => o.doNotRingUp);
    const awaitingPayment = open.filter((o) => !o.chargeId && !o.ledgerUnknown);
    const unknown = open.filter((o) => o.ledgerUnknown);
    const dollars = (rows: { ticketTotal: string | null }[]) =>
      rows.reduce((s, r) => s + Number(String(r.ticketTotal ?? "$0").replace(/[^0-9.]/g, "")), 0).toFixed(2);
    res.status(200).json({
      ok: !ledgerDegraded,
      scanned,
      truncated,
      ledgerDegraded: ledgerDegraded || undefined,
      unknownCount: unknown.length || undefined,
      guidance:
        (ledgerDegraded
          ? `⚠ LEDGER UNREACHABLE for ${unknown.length} ticket(s) — their paid/owed status is UNKNOWN. ` +
            `Do not collect on any ticket in this list until the sheet loads clean. `
          : "") +
        `${alreadyPaid.length} ticket(s) ($${dollars(alreadyPaid)}) were ALREADY charged online — do NOT ` +
        `take payment on these at the Station; void them once matched to their charge id. ` +
        `${awaitingPayment.length} ticket(s) ($${dollars(awaitingPayment)}) are pay-at-counter with NO ` +
        `payment captured — these are owed money. Never treat the two groups alike.`,
      open,
    });
  } catch (err) {
    res.status(502).json({ error: "worklist_failed", detail: err instanceof Error ? err.message : String(err) });
  }
}
