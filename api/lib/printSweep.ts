import { orderLineItemsPrinted } from "./clover.js";
import { alertStaff } from "./notify.js";
import { listQueuedPrints, updateOrder } from "./orderStore.js";

/** How long a ticket may sit in Clover's queue before we stop calling it "slow" and call it stuck.
 *  A job measured on 2026-08-16 took ~16 minutes to reach the printer and did print, so the
 *  threshold sits well past that: alerting sooner reproduces the false alarm this exists to end. */
const STUCK_AFTER_SEC = 25 * 60;

/**
 * Second look at kitchen tickets that were still queued when the order request had to answer
 * the customer.
 *
 * The order path cannot wait for this store's print queue — it has been measured at ~16 minutes,
 * against a 60-second function. So a still-moving job is recorded as `paid_print_queued` and the
 * customer is told the truth (their order is in), with no alert. That is only safe if something
 * comes back and checks, which is this: for each queued row past the threshold, ask Clover whether
 * the order's line items came off a printer. Printed → the row becomes `paid` and nobody is
 * disturbed. Not printed → staff are paged once, with the order id, and the row becomes
 * `paid_print_failed` so it is never paged about twice.
 *
 * Runs opportunistically at the start of the next order and from the nightly cron. Never throws:
 * a sweep problem must not fail the order that triggered it.
 */
export async function sweepQueuedPrints(): Promise<{ checked: number; printed: number; stuck: number }> {
  const out = { checked: 0, printed: 0, stuck: 0 };
  try {
    const rows = await listQueuedPrints(STUCK_AFTER_SEC);
    for (const row of rows) {
      out.checked++;
      const printed = await orderLineItemsPrinted(row.cloverOrderId);
      if (printed) {
        out.printed++;
        await updateOrder(row.id, { status: "paid" });
        console.log(`[print-sweep] order ${row.cloverOrderId} printed after all — row ${row.id} marked paid`);
        continue;
      }
      out.stuck++;
      // Mark first, alert second: if the alert throws the row is still moved out of the queue,
      // so a printer that is down for an hour cannot page staff once per order per sweep.
      await updateOrder(row.id, { status: "paid_print_failed" });
      await alertStaff(
        `KITCHEN TICKET STILL NOT PRINTED — ${row.customerName} $${(row.total / 100).toFixed(2)} — ` +
        `Clover order ${row.cloverOrderId} was PAID over ${Math.round(STUCK_AFTER_SEC / 60)} minutes ago and its ticket ` +
        `never came off the printer. Print it from the POS and check the kitchen printer.`,
      );
      console.error(`[print-sweep] order ${row.cloverOrderId} never printed — staff alerted, row ${row.id}`);
    }
  } catch (err) {
    console.error("[print-sweep] failed", err);
  }
  return out;
}
