import { orderLineItemsPrinted } from "./clover.js";
import { alertStaffOnce } from "./notify.js";
import { listQueuedPrints, listUnresolvedStrands, settleQueuedPrint } from "./orderStore.js";

/** How long a ticket may sit in Clover's queue before "slow" becomes "stuck". Long Branch
 *  measured a healthy job taking ~16 minutes to reach the printer, so the threshold sits
 *  well past that — alerting sooner reproduces the false alarm this exists to end. */
const STUCK_AFTER_SEC = 25 * 60;

/**
 * Second look at kitchen tickets that were still queued when the order request had to answer
 * the customer.
 *
 * The order path cannot wait out this print pipeline (measured in minutes, against a 60-second
 * function), so a still-moving job is recorded as `paid_print_queued` with no alert. That is
 * only safe because this comes back and checks: printed → the row becomes `paid` and nobody is
 * disturbed; not printed → staff are paged (deduped by the print: cooldown window) and the row
 * becomes `paid_print_failed` once the page is confirmed sent. An unresolved stuck ticket
 * re-pages at most once per cooldown window until the row settles — bounded, never per-sweep.
 *
 * Runs opportunistically at the start of the next order and from the nightly menu cron.
 * Never throws: a sweep problem must not fail the order that triggered it.
 */
export async function sweepQueuedPrints(limit = 20): Promise<{ checked: number; printed: number; stuck: number }> {
  const out = { checked: 0, printed: 0, stuck: 0 };
  try {
    const rows = await listQueuedPrints(STUCK_AFTER_SEC, limit);
    for (const row of rows) {
      out.checked++;
      const printed = await orderLineItemsPrinted(row.cloverOrderId);
      if (printed === null) {
        // Couldn't reach Clover — UNKNOWN, not stuck. Leave the row queued; the next sweep
        // asks again. Paging on unknown is how an already-printed ticket paged staff.
        console.warn(`[print-sweep] order ${row.cloverOrderId} status unknown (Clover unreachable) — retrying next sweep`);
        continue;
      }
      if (printed) {
        if (await settleQueuedPrint(row.id, "paid")) {
          out.printed++;
          console.log(`[print-sweep] order ${row.cloverOrderId} printed after all — row ${row.id} marked paid`);
        }
        continue;
      }
      // Page FIRST, settle only on a confirmed send. Settling before the send lost the only
      // page about a stuck PAID ticket whenever the un-awaited sweep froze (or Twilio failed)
      // in the gap — paid_print_failed rows are never revisited by anything. Dedup lives in
      // the page's atomic print: window claim, not in the row: a failed or suppressed page
      // leaves the row queued, so a later sweep re-reads FRESH print evidence and retries.
      // A resolved-meanwhile row can't false-page (fresh printed=true settles it above), and
      // an unresolved one repeats at most once per cooldown window — a reminder about a paid
      // order that is STILL not printed, which is a feature, not the 2026-08-17 bug.
      const paged = await alertStaffOnce(
        `print:${row.cloverOrderId}`,
        `KITCHEN TICKET STILL NOT PRINTED — ${row.customerName} $${(row.total / 100).toFixed(2)} — ` +
        `Clover order ${row.cloverOrderId} was PAID over ${Math.round(STUCK_AFTER_SEC / 60)} minutes ago and its ticket ` +
        `never came off the printer. Print it from the POS and check the kitchen printer.`,
      );
      if (paged === "sent" && (await settleQueuedPrint(row.id, "paid_print_failed"))) {
        out.stuck++;
        console.error(`[print-sweep] order ${row.cloverOrderId} never printed — staff alerted, row ${row.id}`);
      }
    }
  } catch (err) {
    console.error("[print-sweep] failed", err);
  }
  return out;
}

/**
 * One follow-up page per stranded paid order that is still unresolved 35+ minutes on.
 *
 * The order request's own strand page can be lost outright: the function can be killed
 * mid-Twilio-send with the order: claim already committed, and unlike a queued print there is
 * no row state that re-drives the page — paid_unrouted/charged rows otherwise surface only in
 * the pull-based admin worklist nobody was told to open. This runs from the sweep cron with
 * its OWN key namespace (strand:<row id>), so an orphaned order: claim cannot block it.
 *
 * Deliberately ONE reminder (the cooldown outlives the row's 24-hour reminder eligibility):
 * a row staff resolved by hand leaves no trace here, and nagging a fixed problem every window
 * is the exact noise this file exists to end. Worst case per stranded order: the original
 * page + one reminder. Cron-only — never on the order path.
 */
const STRAND_REMIND_ONCE_SEC = 24 * 3600;

export async function remindStrandedOrders(): Promise<{ checked: number; reminded: number }> {
  const out = { checked: 0, reminded: 0 };
  try {
    const rows = await listUnresolvedStrands();
    for (const row of rows) {
      out.checked++;
      const money = `$${(row.total / 100).toFixed(2)}`;
      // Three strand flavors, three recovery instructions — matching the original alerts.
      const detail = row.status === "refire_pending"
        ? `staff recovery was interrupted; check Clover for an existing ticket before making any replacement. Do NOT refire or re-charge.`
        : row.chargeId && !row.cloverOrderId
        ? `charge ${row.chargeId} — refire it from the admin worklist (do NOT re-charge).`
        : row.cloverOrderId
          ? `Clover order ${row.cloverOrderId} may hold the payment — open it in the POS: if it is paid, make it; if not, it can be voided.`
          : `the charge may have captured without a confirmation — check Clover payments before doing anything else.`;
      const paged = await alertStaffOnce(
        `strand:${row.id}`,
        `STILL UNRESOLVED — web order for ${row.customerName} ${money} was charged (or may have been) and never reached the kitchen: ${detail}`,
        STRAND_REMIND_ONCE_SEC,
      );
      if (paged === "sent") {
        out.reminded++;
        console.error(`[strand-remind] row ${row.id} (${row.status}) still unresolved — staff reminded`);
      }
    }
  } catch (err) {
    console.error("[strand-remind] failed", err);
  }
  return out;
}
