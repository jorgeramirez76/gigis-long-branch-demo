import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../lib/adminAuth.js";
import { printOnDevice, printOrderTicket } from "../lib/clover.js";
import { getOrderForRefire, updateOrder } from "../lib/orderStore.js";

/**
 * Re-run the kitchen ticket for an order that is ALREADY in the POS.
 *
 * The gap this fills: refire-order recovers orders that never reached Clover, but an order
 * whose ticket simply failed to print (printer reported FAILED — Jeanette Acevedo, $60.78,
 * 2026-08-27, order 09B2EKJXSRF96) has a Clover order id, so refire correctly refuses it,
 * and nothing else in the system ever re-drives the print. sweepQueuedPrints only checks and
 * pages; it never reprints. Until now the only recovery was staff making the ticket by hand
 * from the Station screen.
 *
 * POST { id }            → print the ticket again on the CONFIGURED route(s).
 * POST { id, deviceId }  → print it on ONE specific device instead — the recovery move
 *                          when the configured route's printer is down and staff have
 *                          named a working one (found via admin/printer-test).
 *
 * SAFETY:
 *  - Print-only. It never charges, never creates or mutates a Clover order — the single
 *    side effect is a print_event on the order the row already points at.
 *  - Only rows with a clover_order_id are eligible (the exact complement of refire-order),
 *    and only for this business — a mis-typed id cannot print another shop's ticket.
 *  - A ticket that already printed comes out stamped REPRINT by Clover, so a duplicate is
 *    visible to the line — the same residual risk profile as staff reprinting from the POS.
 *  - A queued result on a card-paid row is recorded as paid_print_queued so the delayed
 *    sweep follows up, exactly like the order path. No staff page here: this endpoint is
 *    operator-triggered, so the operator is already watching the result.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireAdmin(req, res))) return;

  const BUSINESS = "gigis_long_branch";

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const id = Number((req.body ?? {})?.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "bad_id", message: "Pass the web_orders row id, e.g. { \"id\": 43 }." });
    return;
  }

  const row = await getOrderForRefire(id);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (row.business !== BUSINESS) {
    res.status(403).json({ error: "wrong_business" });
    return;
  }
  if (!row.cloverOrderId) {
    res.status(409).json({
      error: "not_in_pos",
      message: `Order #${id} has no Clover order — use refire-order to recover it, not reprint.`,
    });
    return;
  }

  // A named device overrides the configured fan-out: when the normal route's printer is
  // down, printing there again is already known-useless — aim at the device staff said works.
  const deviceId = typeof (req.body ?? {})?.deviceId === "string" ? String((req.body as Record<string, unknown>).deviceId).trim() : "";
  let printed: { printed: boolean; queued?: boolean; eventId?: string; state?: string; error?: string };
  if (deviceId) {
    const r = await printOnDevice(row.cloverOrderId, deviceId);
    const st = r.state?.trim().toUpperCase();
    printed = {
      printed: st === "PRINTED",
      queued: st === "CREATED" || st === "PRINTING",
      eventId: r.eventId,
      state: r.state,
      error: r.error,
    };
  } else {
    printed = await printOrderTicket(row.cloverOrderId);
  }

  // Same handoff as the order path: a job still moving through Clover's queue gets the
  // sweep's follow-up. Only paid rows — the sweep promotes a printed queued row back to
  // "paid", which must never touch a pay-at-pickup row whose money isn't collected.
  let sweepArmed = false;
  if (printed.queued && row.status === "paid") {
    sweepArmed = await updateOrder(id, { status: "paid_print_queued" });
  }

  console.log(
    `[admin/reprint-ticket] order #${id} (Clover ${row.cloverOrderId}) → ` +
    `${printed.printed ? "PRINTED" : printed.queued ? "queued" : "FAILED"} (state ${printed.state ?? "?"})`,
  );

  res.status(200).json({
    ok: true,
    id,
    cloverOrderId: row.cloverOrderId,
    customer: row.customerName,
    total: `$${(row.total / 100).toFixed(2)}`,
    printed: printed.printed,
    queued: !!printed.queued,
    state: printed.state ?? null,
    error: printed.error ?? null,
    sweepArmed,
    message: printed.printed
      ? `Ticket for Clover ${row.cloverOrderId} PRINTED.`
      : printed.queued
        ? `Ticket is in Clover's print queue${sweepArmed ? " — the sweep will follow up if it sticks" : ""}. Watch the printer for the next few minutes.`
        : `Ticket did NOT print (${printed.error ?? printed.state ?? "no detail"}). Make it from the Station screen.`,
  });
}
