import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../lib/adminAuth.js";
import { closePosOrder, getOrderSummary, listOpenWebsiteOrders, CloverError, WEBSITE_TITLE_RE } from "../lib/clover.js";
import { getCaptureByCloverId, listWorklistCandidates } from "../lib/orderStore.js";

/**
 * Take a STRANDED website ticket off the POS's open-orders list.
 *
 *   GET  /api/admin/close-order                → website orders still open (newest first)
 *   GET  /api/admin/close-order?orderId=XXXX   → read-only inspection (decide before acting)
 *   POST /api/admin/close-order { orderId }    → state → "locked"
 *
 * Why this exists: a card order that took the two-order fallback has its payment recorded as a
 * standalone Clover ecommerce charge, not as a tender on the itemized ticket. The POS therefore
 * shows the ticket as OPEN with "no transactions for this order" even though the customer paid
 * in full — which is how a paid, delivered order (Mary Clauberg, $165.72, 2026-08-20) came to
 * look unpaid to staff. The root cause is fixed separately (totals rounding, see
 * docs/plans/2026-08-20-lb-parity-plan.md §4); this clears the tickets already stranded by it.
 *
 * ⚠ MEASURED LIMIT (2026-08-20, order 374ENQ16WCJ24): Clover will NOT keep a ticket locked
 * while it carries a balance with no tender attached — it accepted the flip, reported "locked"
 * on an immediate re-read, then reopened the order minutes later. paymentState is derived from
 * tenders, which is also why fireOrder's `paymentState: "PAID"` write never sticks on these.
 * So a stranded fallback ticket cannot be closed through this API; it has to be settled on the
 * Station. The worklist below is still the way to FIND them (it surfaced a second stranded
 * order nobody had noticed), and the close path now verifies durably and says so plainly
 * rather than reporting a success that undoes itself. The real fix is upstream: stop the
 * two-order fallback (docs/plans/2026-08-20-lb-parity-plan.md §4).
 *
 * SAFETY — "PAID" alone is NOT the signature of a finished order. fireOrder stamps
 * state:"open" + paymentState:"PAID" on EVERY card web order the moment it fires, so a ticket
 * the kitchen is cooking right now looks identical on those two fields — and the newest-first
 * worklist would offer it FIRST. The discriminator is the tender:
 *
 *   healthy single-order ticket → payments >= 1  (money attached; staff close it on the Station)
 *   stranded fallback ticket    → payments == 0  (money lives on a separate ecommerce charge)
 *
 * So the mutation requires payments === 0, plus a positively fired state ("open" — never a
 * draft, which is the paid-but-never-routed recovery case that needs a human), plus an explicit
 * confirmRecent for anything placed in the last two hours. It NEVER creates, voids, or refunds
 * a payment: the charge stays where Clover already has it, and adding a tender here would
 * double-count the sale.
 */

/** An order this new is far more likely to be live than stranded — require an explicit override. */
const RECENT_MINUTES = 120;

/** Pause before the confirming re-read, so a revert is caught rather than reported as success. */
const VERIFY_DELAY_MS = Number(process.env.CLOSE_ORDER_VERIFY_MS ?? 4000);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireAdmin(req, res))) return;
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const raw = req.method === "GET" ? req.query.orderId : (req.body ?? {})?.orderId;
  const orderId = typeof raw === "string" ? raw.trim() : "";
  const money = (c?: number) => (typeof c === "number" ? `$${(c / 100).toFixed(2)}` : "—");
  const ageMinutes = (t?: number) => (t ? Math.round((Date.now() - t) / 60000) : null);

  // The worklist — only when the parameter was genuinely ABSENT. A present-but-unusable value
  // (`?orderId=`, or a repeated param that arrives as an array) must not silently widen a
  // single-order lookup into a dump of every open order's customer details.
  if (req.method === "GET" && raw === undefined) {
    try {
      const rows = await listOpenWebsiteOrders();
      // SECOND NET: the scan above is a window over EVERY ticket the shop rang up, and a
      // stranded web ticket older than the window never appears in it — Cole's still-open
      // 8/25 pay-at-counter ticket had already fallen out by 8/29. Our own ledger knows every
      // Clover order id we ever created, so any candidate the scan missed is checked
      // individually; getOrderSummary answers regardless of how old the ticket is.
      const scanned = new Set(rows.orders.map((o) => o.id));
      const candidates = (await listWorklistCandidates()).filter((c) => !scanned.has(c.cloverOrderId)).slice(0, 30);
      for (const c of candidates) {
        try {
          const sum = await getOrderSummary(c.cloverOrderId);
          if (
            String(sum.state ?? "").toLowerCase() === "open" &&
            typeof sum.title === "string" &&
            WEBSITE_TITLE_RE.test(sum.title)
          ) {
            rows.orders.push({
              id: sum.id,
              title: sum.title,
              state: sum.state,
              paymentState: sum.paymentState,
              total: sum.total,
              note: sum.note,
              paymentCount: sum.paymentCount,
              lineItemCount: sum.lineItemCount,
              createdTime: sum.createdTime,
            });
          }
        } catch {
          // A candidate Clover no longer has (deleted ticket) is not an open ticket.
        }
      }
      // Few by nature (a stranded ticket is the exception), so a lookup each is cheap and
      // makes `closeable` mean what the POST will actually do rather than an approximation.
      let ledgerDegraded = false;
      const open = await Promise.all(
        rows.orders.map(async (o) => {
          let capture: Awaited<ReturnType<typeof getCaptureByCloverId>> = null;
          let ledgerUnknown = false;
          try {
            capture = await getCaptureByCloverId(o.id);
          } catch {
            // Ledger unreachable for this row. Without this, a database blip turns every
            // paid-online ticket into "owed money" and sends staff to double-charge.
            ledgerUnknown = true;
            ledgerDegraded = true;
          }
          const paid = String(o.paymentState ?? "").toUpperCase() === "PAID" || !!capture?.chargeId;
          const age = ageMinutes(o.createdTime);
          return {
            orderId: o.id,
            state: o.state ?? null,
            paymentState: o.paymentState ?? null,
            total: money(o.total),
            payments: o.paymentCount,
            ageMinutes: age,
            createdAt: o.createdTime ? new Date(o.createdTime).toISOString() : null,
            chargeId: capture?.chargeId ?? null,
            ourStatus: capture?.status ?? null,
            ourTotal: capture ? money(capture.total) : null,
            // The reconciliation a person actually needs: does the money we captured match the
            // money on this ticket? The two figures are not the same quantity, and comparing
            // them raw reported "disagree" on precisely the tickets this exists to identify:
            //   CARD  — the tip is captured with the payment and kept OFF the ticket, so the
            //           ticket is our total MINUS the tip (Paul Johnson: 17835 - 1484 = 16351).
            //   COUNTER — the tip is a line item ON the ticket, so the two match outright.
            totalsAgree:
              capture != null &&
              typeof o.total === "number" &&
              (capture.paymentMethod === "card" ? capture.total - capture.tip : capture.total) === o.total,
            // Ringing this ticket up on the Station would take a SECOND payment for food that
            // is already paid for. Stated per row so it cannot be missed.
            ledgerUnknown,
            doNotRingUp: o.paymentCount === 0 && !!capture?.chargeId,
            // Exactly the POST's guard set, so nobody has to infer it from the raw fields.
            closeable: o.paymentCount === 0 && String(o.state ?? "").toLowerCase() === "open" && paid,
            needsConfirmRecent: age !== null && age < RECENT_MINUTES,
            likelyLive: o.paymentCount > 0 || (age ?? 999) < RECENT_MINUTES,
            ticket: o.note ?? null,
          };
        }),
      );
      // An open website ticket is one of TWO opposite things, and treating them alike is how
      // money goes missing in either direction: a split card order (already charged online —
      // ringing it up bills the customer twice) or an ordinary pay-at-counter order (nothing
      // captured — it MUST be rung up). The only reliable discriminator is whether we hold a
      // charge id for it, so the counts are reported separately and never summed.
      const alreadyPaid = open.filter((o) => o.doNotRingUp);
      // "Owed money" requires a POSITIVE ledger answer of no charge — a row the ledger could
      // not answer for goes in neither bucket and the response says the sheet is incomplete.
      const awaitingPayment = open.filter((o) => !o.chargeId && !o.ledgerUnknown);
      const unknown = open.filter((o) => o.ledgerUnknown);
      const dollars = (rows: { total: string | null }[]) =>
        rows.reduce((sum, r) => sum + Number(String(r.total ?? "$0").replace(/[^0-9.]/g, "")), 0).toFixed(2);
      res.status(200).json({
        ok: !ledgerDegraded,
        ledgerDegraded: ledgerDegraded || undefined,
        unknownCount: unknown.length || undefined,
        guidance:
          (ledgerDegraded
            ? `⚠ LEDGER UNREACHABLE for ${unknown.length} ticket(s) — their paid/owed status is UNKNOWN. ` +
              `Do not collect on any ticket in this list until the sheet loads clean. `
            : "") +
          `${alreadyPaid.length} ticket(s) ($${dollars(alreadyPaid)}) were ALREADY charged online — ` +
          `do NOT take payment on these at the Station; it would bill the customer twice and ` +
          `double-count the sale. ` +
          `${awaitingPayment.length} ticket(s) ($${dollars(awaitingPayment)}) are pay-at-counter with ` +
          `NO payment captured — these are owed money and should be collected normally. ` +
          `Never treat the two groups alike.`,
        alreadyPaidCount: alreadyPaid.length,
        awaitingPaymentCount: awaitingPayment.length,
        scanned: rows.scanned,
        truncated: rows.truncated,
        oldestScanned: rows.oldestScanned ? new Date(rows.oldestScanned).toISOString() : null,
        note: rows.truncated
          ? "Scan stopped at the page cap — older stranded tickets may exist beyond this window."
          : "Scanned every order Clover returned, back to oldestScanned.",
        open,
      });
    } catch (err) {
      console.error("[admin/close-order] list failed", err instanceof Error ? err.message : err);
      res.status(502).json({ error: "clover_request_failed", message: "Couldn't reach Clover for the open-order list." });
    }
    return;
  }

  if (!/^[A-Z0-9]{8,32}$/i.test(orderId)) {
    res.status(400).json({
      error: "bad_order_id",
      message: 'Pass the Clover ORDER id from GET /api/admin/close-order — e.g. { "orderId": "<id from the worklist>" }. A charge id will not resolve here.',
    });
    return;
  }

  try {
    const order = await getOrderSummary(orderId);
    const age = ageMinutes(order.createdTime);
    const view = {
      orderId: order.id,
      title: order.title ?? null,
      state: order.state ?? null,
      paymentState: order.paymentState ?? null,
      total: money(order.total),
      payments: order.paymentCount,
      lineItems: order.lineItemCount,
      ageMinutes: age,
      ticket: order.note ?? null,
    };

    if (req.method === "GET") {
      res.status(200).json({ ok: true, ...view });
      return;
    }

    if (!order.title || !WEBSITE_TITLE_RE.test(order.title)) {
      res.status(403).json({
        error: "not_a_website_order",
        message: `Order ${orderId} isn't a website order (title: ${order.title ?? "none"}). Close it on the Station screen instead.`,
        ...view,
      });
      return;
    }
    if (String(order.state ?? "").toLowerCase() === "locked") {
      res.status(200).json({ ok: true, alreadyClosed: true, message: `Order ${orderId} was already closed.`, ...view });
      return;
    }
    // Positively fired. A draft (no state) is the paid-but-never-routed case: it holds money and
    // the kitchen never saw it, so it needs a human in the POS, not a quiet close.
    if (String(order.state ?? "").toLowerCase() !== "open") {
      res.status(409).json({
        error: "not_fired",
        message: `Order ${orderId} is ${order.state ?? "a draft that never fired"} — it never reached the kitchen. Open it in the POS; do not close it here.`,
        ...view,
      });
      return;
    }
    // THE discriminator — see the header. A tender on the ticket means it is a normal order.
    if (order.paymentCount > 0) {
      res.status(409).json({
        error: "payment_attached",
        message: `Order ${orderId} carries its own payment, so it is a normal ticket — possibly one being made right now. Close it on the Station screen.`,
        ...view,
      });
      return;
    }
    // Proof of payment. Clover DERIVES paymentState from attached tenders, so the stranded
    // shape this endpoint exists for reads OPEN even though the customer was charged — the
    // money is a standalone ecommerce charge. Our own ledger is what knows a capture happened,
    // so either an attached-tender PAID or a ledger row carrying the charge id will do; with
    // neither, refuse rather than hide a ticket the shop may still be owed for.
    const capture = await getCaptureByCloverId(orderId);
    const cloverSaysPaid = String(order.paymentState ?? "").toUpperCase() === "PAID";
    if (!cloverSaysPaid && !capture?.chargeId) {
      res.status(409).json({
        error: "not_paid",
        message: capture
          ? `Order ${orderId} is ${order.paymentState ?? "unknown"} and our records show no charge for it (status ${capture.status}) — not closing a ticket the shop may still be owed for.`
          : `Order ${orderId} is ${order.paymentState ?? "unknown"} and has no matching website order in our records — close it on the Station screen after checking Clover payments.`,
        ...view,
      });
      return;
    }
    const confirmRecent = (req.body ?? {})?.confirmRecent === true;
    if (age !== null && age < RECENT_MINUTES && !confirmRecent) {
      res.status(409).json({
        error: "too_recent",
        message: `Order ${orderId} was placed ${age} minutes ago and may still be in progress. Re-send with { "confirmRecent": true } if the food has gone out.`,
        ...view,
      });
      return;
    }

    await closePosOrder(orderId);
    let after = await getOrderSummary(orderId);
    // VERIFY DURABLY. Measured live on 2026-08-20 against order 374ENQ16WCJ24: Clover accepted
    // the flip and the immediate re-read said "locked", then the order was back to "open"
    // minutes later. Clover derives paymentState from attached tenders, so a ticket carrying a
    // balance with zero tenders is not settled and will not hold a lock — an immediate re-read
    // alone reports a success that quietly undoes itself.
    if (String(after.state ?? "").toLowerCase() === "locked") {
      await new Promise((r) => setTimeout(r, VERIFY_DELAY_MS));
      after = await getOrderSummary(orderId);
    }
    if (String(after.state ?? "").toLowerCase() !== "locked") {
      // Clover accepted the request but the ticket did not move — report the failure, never ok.
      console.error("[admin/close-order] reverted", orderId, "state back to", after.state);
      res.status(409).json({
        error: "clover_reopened_it",
        message:
          `Clover took the request but put order ${orderId} back to ${after.state ?? "open"}. A ticket with a balance ` +
          `and no tender on it is not settled, so Clover will not keep it closed — the payment for this one is the ` +
          `separate ecommerce charge ${capture?.chargeId ?? "on the account"}. Settle it on the Station screen instead; ` +
          `nothing here changed the money.`,
        before: view,
        after: { state: after.state ?? null, paymentState: after.paymentState ?? null, payments: after.paymentCount },
      });
      return;
    }
    console.log(`[admin/close-order] closed ${orderId} ${money(after.total)} (was open, ${order.paymentCount} tenders, ${age ?? "?"} min old, charge ${capture?.chargeId ?? "clover-paid"})`);
    res.status(200).json({
      ok: true,
      closed: true,
      paidBy: capture?.chargeId ? `ecommerce charge ${capture.chargeId}` : "tender attached to the ticket",
      message: `Order ${orderId} (${money(after.total)}) is now closed. No payment record was created or changed.`,
      before: view,
      after: { state: after.state ?? null, paymentState: after.paymentState ?? null, payments: after.paymentCount },
    });
  } catch (err) {
    const status = err instanceof CloverError ? err.status : 500;
    console.error("[admin/close-order]", orderId, status, err instanceof Error ? err.message : err);
    if (status === 404) {
      res.status(404).json({
        error: "not_found",
        message: `Clover has no order ${orderId} on this merchant. Note a Clover CHARGE id is not an order id — take the id from GET /api/admin/close-order.`,
      });
      return;
    }
    res.status(502).json({ error: "clover_request_failed", status, message: "Couldn't reach Clover for that order — try again in a moment." });
  }
}
