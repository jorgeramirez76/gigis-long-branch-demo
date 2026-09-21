import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../lib/adminAuth.js";
import { claimRefireOrder, getOrderForRefire, listStrandedOrders, settleQueuedPrint, updateOrder } from "../lib/orderStore.js";
import {
  buildOrderNote,
  CloverRoutingUncertainError,
  createPosOrder,
  printOrderTicket,
  type CartLineInput,
} from "../lib/clover.js";
import { alertStaffOnce } from "../lib/notify.js";

/**
 * Recover a PAID order that never reached the POS.
 *
 * On 2026-08-15 a $100.99 delivery was charged (W9F36DXA4G8RE) and createPosOrder threw, so
 * the kitchen never saw it. The row landed in web_orders as paid_unrouted and the only
 * recourse was staff re-keying the whole order by hand off an SMS alert — with the customer
 * already waiting and the money already taken.
 *
 * This rebuilds the POS ticket from the SAME server-priced lines the original attempt used,
 * so the kitchen gets exactly what the customer bought, at the price they were charged.
 *
 * GET  → the worklist of stranded orders.
 * POST { id } → refire that one.
 *
 * SAFETY — the whole point is that this must never take money or duplicate a ticket:
 *  - It NEVER charges. There is no card path in this file; the capture already happened.
 *  - Eligibility is deliberately narrow: paid_unrouted/charged, a real charge_id, and NO
 *    clover_order_id. A row that already carries a Clover order id is excluded, because that
 *    order may itself hold the payment — those are the human-verify cases, not auto-refire.
 *  - Success writes clover_order_id, which makes a second refire ineligible. That is the
 *    idempotency: the row's own state is the lock.
 *  - A durable refire_pending claim is made before contacting Clover. Failed or interrupted
 *    attempts stay blocked for manual reconciliation; an expired cooldown never reissues them.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireAdmin(req, res))) return;

  const BUSINESS = "gigis_long_branch";

  if (req.method === "GET") {
    const rows = await listStrandedOrders(BUSINESS);
    res.status(200).json({
      stranded: rows.map((r) => ({
        id: r.id,
        status: r.status,
        requiresManualReview: r.status === "refire_pending",
        chargeId: r.chargeId,
        total: `$${(r.total / 100).toFixed(2)}`,
        customer: r.customerName,
        createdAt: r.createdAt,
      })),
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const id = Number((req.body ?? {})?.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "bad_id", message: "Pass the web_orders row id, e.g. { \"id\": 11 }." });
    return;
  }

  const row = await getOrderForRefire(id);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (row.business !== BUSINESS) {
    // Each store has its own database and Clover merchant; refusing here means a mis-typed
    // id can never fire one shop's order into the other's kitchen.
    res.status(403).json({ error: "wrong_business" });
    return;
  }
  if (row.cloverOrderId) {
    res.status(409).json({
      error: "already_in_pos",
      message: `Order #${id} already has Clover order ${row.cloverOrderId} — open it in the POS rather than refiring.`,
    });
    return;
  }
  if (!row.chargeId) {
    res.status(409).json({
      error: "not_paid",
      message: `Order #${id} has no charge recorded — nothing was captured, so there is nothing to recover.`,
    });
    return;
  }
  if (row.status !== "paid_unrouted" && row.status !== "charged") {
    res.status(409).json({ error: "not_eligible", message: `Order #${id} is '${row.status}'.` });
    return;
  }

  const lines = row.items as CartLineInput[];
  if (!Array.isArray(lines) || lines.length === 0) {
    res.status(422).json({ error: "no_lines", message: `Order #${id} has no stored line items — re-key it by hand.` });
    return;
  }

  // New orders retain their exact fee. Legacy rows derive the remaining charged amount.
  const deliveryFee = row.fee ?? Math.max(0, row.total - row.subtotal - row.cardPricing - row.tax - row.tip);
  const totals = {
    subtotal: row.subtotal,
    cardPricing: row.cardPricing,
    tax: row.tax,
    tip: row.tip,
    total: row.total,
    deliveryFee,
    discount: row.discount,
  };

  const note = buildOrderNote({
    fulfillment: row.fulfillment,
    customer: {
      name: row.customerName,
      phone: row.customerPhone,
      email: row.customerEmail ?? undefined,
      address: row.address ?? undefined,
      // Town, same as the original chit. buildOrderNote appends it to the delivery address line
      // so the driver sees the zone the fee was charged for; omitting it here printed a refired
      // delivery with a bare street and no town — the one ticket where the customer is already
      // waiting and staff have the least context.
      town: row.town ?? undefined,
    },
    lines,
    totals,
    payment: "card",
    chargeId: row.chargeId,
    orderNote: `REFIRED by staff — original attempt never reached the POS`,
    // The refire chit is a HEADER too (the stored lines are re-sent as line items and
    // carry the item detail). We don't re-run the VIP lookup here — an admin recovery
    // must not depend on another DB read — but the stored promo code is enough to keep
    // the ★ VIP PROMO ★ marker the original ticket had.
    vipPromo: row.promoCode != null,
  });

  // Persist before contacting Clover. A lost response or failed pointer write leaves
  // this row blocked for manual reconciliation, even after process restart.
  if (!(await claimRefireOrder(id, BUSINESS))) {
    res.status(409).json({
      error: "refire_in_progress",
      message: `Order #${id} is already being refired — give it a few seconds and refresh the worklist.`,
    });
    return;
  }

  try {
    const order = await createPosOrder({
      lines,
      fulfillment: row.fulfillment,
      note,
      paid: true,
      deliveryFee,
      cardPricing: row.cardPricing,
    });
    if (!(await updateOrder(id, { status: "paid", cloverOrderId: order.id, note }))) {
      throw new CloverRoutingUncertainError(order.id, new Error("Recovery ledger write failed"));
    }

    const printed = await printOrderTicket(order.id);
    let queuedRecorded = false;
    if (printed.queued) {
      // Clover's print queue at this store runs minutes — a job still moving is not a
      // failure. Treating queued as "did not print" here paged staff about tickets that
      // came out fine moments later. Record it for the sweep (which ages on updated_at,
      // so the stuck clock starts at THIS refire) — but the sweep only runs on order
      // traffic and the overnight cron, so the response below tells the staffer to
      // check the printer themselves rather than promising a page that may come late.
      queuedRecorded = await updateOrder(id, { status: "paid_print_queued" });
      if (!queuedRecorded) {
        // The handoff to the sweep didn't stick, so nothing would ever follow up —
        // fall back to the noisy-but-safe immediate page.
        await alertStaffOnce(
          `print:${order.id}`,
          `REFIRED ORDER PRINT UNCONFIRMED — order #${id}, Clover ${order.id} is in the POS; confirm a ticket came off the printer, else make it from the Station screen.`,
        );
      }
    } else if (!printed.printed) {
      await updateOrder(id, { status: "paid_print_queued" });
      const paged = await alertStaffOnce(
        `print:${order.id}`,
        `REFIRED ORDER DID NOT PRINT — order #${id}, Clover ${order.id} is in the POS but no ticket printed. Make it from the Station screen.`,
      );
      if (paged === "sent") await settleQueuedPrint(id, "paid_print_failed");
    }
    res.status(200).json({
      ok: true,
      id,
      cloverOrderId: order.id,
      printed: printed.printed,
      queued: !!printed.queued,
      message: `Order #${id} is now in the POS as ${order.id}${
        printed.printed
          ? " and the ticket printed."
          : printed.queued
            ? " — the ticket is still in the print queue. Watch the printer for the next few minutes; if nothing comes out, print it from the Station screen."
            : " — but the ticket did NOT print; make it from the Station screen."
      }`,
    });
  } catch (err) {
    console.error("[admin/refire-order] failed", id, err);
    if (err instanceof CloverRoutingUncertainError) {
      // Clover may have opened this exact order but lost the response. Persist
      // its id so another staff retry cannot create a second kitchen ticket.
      await updateOrder(id, {
        status: "refire_pending",
        cloverOrderId: err.orderId,
        note,
      });
      res.status(409).json({
        error: "refire_uncertain",
        message: `Clover may have received order ${err.orderId}. Open that order in the POS before doing anything else; do not refire or recharge it.`,
      });
      return;
    }

    res.status(502).json({
      error: "refire_uncertain",
      message: `Could not confirm whether order #${id} reached the POS. Its recovery result is uncertain. Check Clover for an existing ticket before making any replacement; automatic refire is blocked. The customer has already paid — do not charge again.`,
    });
  }
}
