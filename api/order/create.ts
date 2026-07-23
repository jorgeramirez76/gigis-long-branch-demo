import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  buildOrderNote,
  cloverConfigured,
  computeTotals,
  createCharge,
  createDraftOrder,
  createPosOrder,
  deleteDraftOrder,
  fireOrder,
  getEcommOrderAmount,
  payForOrder,
  CloverError,
  MAX_UNITS,
  unitPrice,
  type CartLineInput,
  type Fulfillment,
  type Totals,
} from "../lib/clover.js";
import { priceLines, type ClientLine } from "../lib/menuCatalog.js";
import { rateLimitAll } from "../lib/rateLimit.js";
import { peekOrder, reserveOrder, updateOrder } from "../lib/orderStore.js";
import { alertStaff, sendReceiptEmail } from "../lib/notify.js";
import { receiptHtml } from "../lib/emailTemplate.js";
import { verifyTurnstile } from "../lib/turnstile.js";

/** Best-effort branded receipt email — env-gated, never blocks or fails the order. */
async function sendOrderReceipt(o: {
  email?: string;
  name: string;
  fulfillment: Fulfillment;
  address?: string;
  lines: CartLineInput[];
  totals: Totals;
  paymentMethod: "card" | "pickup" | "cash";
  orderId: string;
}): Promise<void> {
  if (!o.email) return;
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const paymentLine =
    o.paymentMethod === "card"
      ? `Paid online — ${money(o.totals.total)} charged to your card.`
      : o.paymentMethod === "cash"
        ? `Paying cash: please have ${money(o.totals.total)} ready ${o.fulfillment === "delivery" ? "for your delivery driver" : "at pickup"} — your 3.99% cash discount is already included.`
        : `${money(o.totals.total)} due when you ${o.fulfillment === "delivery" ? "receive your delivery" : "pick up"}.`;
  try {
    const html = receiptHtml({
      customerName: o.name,
      fulfillment: o.fulfillment,
      orderRef: o.orderId.slice(-8).toUpperCase(),
      address: o.address,
      lines: o.lines.map((l) => ({
        quantity: l.quantity,
        name: l.itemName,
        options: l.options.map((x) => x.name).join(", ") || undefined,
        lineTotal: money(unitPrice(l) * l.quantity),
      })),
      subtotal: money(o.totals.subtotal),
      discount: o.totals.discount ? money(o.totals.discount) : undefined,
      tax: money(o.totals.tax),
      tip: o.totals.tip ? money(o.totals.tip) : undefined,
      total: money(o.totals.total),
      paymentLine,
    });
    const r = await sendReceiptEmail(o.email, `Order received — Gigi's NY Style Pizza (${money(o.totals.total)})`, html);
    if (!r.sent && r.error !== "email_not_configured") console.error("[order/create] receipt email failed:", r.error);
  } catch (e) {
    console.error("[order/create] receipt email error", e);
  }
}

const US_PHONE_RE = /^\+?1?[\s.-]?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CARD_MIN_TOTAL = 100; // $1.00 — thin anti-card-testing floor
const MAX_OPTS_PER_LINE = 25;
const ADDR_MAX = 120;

/** Canonical 10-digit key for a validated US phone (so +1 / 1 / bare all collapse). */
function phoneIdentity(phone: string): string {
  const m = US_PHONE_RE.exec(phone);
  return m ? m[1] + m[2] + m[3] : phone.replace(/\D/g, "").slice(-10);
}
const maskPhone = (p: string) => "•••" + p.replace(/\D/g, "").slice(-4);

/** Validate SHAPE only — prices are resolved server-side from the catalog, never trusted here. */
function validShape(input: unknown): input is ClientLine[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 60) return false;
  return input.every(
    (l) =>
      l &&
      typeof l.itemName === "string" &&
      l.itemName.trim().length > 0 &&
      Number.isInteger(l.quantity) &&
      l.quantity >= 1 &&
      l.quantity <= MAX_UNITS &&
      (l.categoryId == null || typeof l.categoryId === "string") &&
      (l.options == null ||
        (Array.isArray(l.options) &&
          l.options.length <= MAX_OPTS_PER_LINE &&
          l.options.every((o: unknown) => {
            const opt = o as { name?: unknown; group?: unknown };
            return opt && typeof opt.name === "string" && (opt.group == null || typeof opt.group === "string");
          }))),
  );
}

/** Trusted client IP. Vercel sets x-real-ip to the true client IP; we deliberately
 * do NOT fall back to x-forwarded-for, whose leftmost hop is client-spoofable
 * off-platform (which would let an attacker rotate past the IP rate limit). */
function clientIp(req: VercelRequest): string | undefined {
  const real = req.headers["x-real-ip"];
  return typeof real === "string" && real ? real : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const fulfillment = body.fulfillment as Fulfillment;
  const customer = (body.customer ?? {}) as { name?: string; phone?: string; email?: string; address?: string };
  const paymentMethod =
    body.paymentMethod === "card" ? "card" : body.paymentMethod === "cash" ? "cash" : "pickup";
  const cardToken = typeof body.cardToken === "string" ? body.cardToken : undefined;
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : undefined;
  const tipCents = Number.isFinite(body.tipCents) ? Number(body.tipCents) : 0;
  const orderNote = typeof body.orderNote === "string" ? body.orderNote.slice(0, 130) : undefined;

  // ---- validate shape ----
  if (fulfillment !== "pickup" && fulfillment !== "delivery") {
    res.status(400).json({ error: "invalid_fulfillment" });
    return;
  }
  if (typeof customer.name !== "string" || customer.name.trim().length < 1 || customer.name.length > 80) {
    res.status(400).json({ error: "name_required" });
    return;
  }
  if (typeof customer.phone !== "string" || !US_PHONE_RE.test(customer.phone)) {
    res.status(400).json({ error: "valid_phone_required" });
    return;
  }
  if (fulfillment === "delivery" && (typeof customer.address !== "string" || customer.address.trim().length < 5)) {
    res.status(400).json({ error: "delivery_address_required" });
    return;
  }
  if (!UUID_RE.test(idempotencyKey)) {
    res.status(400).json({ error: "idempotency_key_required" });
    return;
  }
  if (!validShape(body.lines)) {
    res.status(400).json({ error: "invalid_lines" });
    return;
  }
  const clientLines = body.lines as ClientLine[];
  const totalUnits = clientLines.reduce((s, l) => s + l.quantity, 0);
  if (totalUnits > MAX_UNITS) {
    res.status(400).json({ error: "order_too_large", message: `For orders over ${MAX_UNITS} items, please call the store.` });
    return;
  }

  // ---- idempotent replay BEFORE rate limiting: a customer retrying a lost
  //      response (esp. one already charged) must get the reassuring result,
  //      not a 429. Unknown keys fall through to the normal throttled path. ----
  const prior = await peekOrder(idempotencyKey);
  if (prior?.cloverOrderId) {
    res.status(200).json({ ok: true, orderId: prior.cloverOrderId, paid: prior.status === "paid", duplicate: true });
    return;
  }
  if (prior?.chargeId) {
    res.status(200).json({ ok: true, paid: true, chargeId: prior.chargeId, routingIssue: true, message: "Your payment went through — please call the store to confirm your order." });
    return;
  }

  const ip = clientIp(req);

  // ---- bot check (Cloudflare Turnstile) — skipped until configured. Defeats
  //      IP/phone rotation and doesn't depend on the rate-limiter DB. ----
  if (!(await verifyTurnstile(turnstileToken, ip))) {
    res.status(403).json({ error: "verification_failed", message: "Please complete the verification and try again." });
    return;
  }

  // ---- rate limit (before ANY side effect) ----
  const phoneKey = phoneIdentity(customer.phone);
  const allowed = await rateLimitAll([
    ...(ip ? [{ bucket: `order:ip:${ip}`, max: 6, windowSec: 60 }, { bucket: `order:ip:${ip}:h`, max: 40, windowSec: 3600 }] : []),
    { bucket: `order:phone:${phoneKey}`, max: 4, windowSec: 600 },
  ]);
  if (!allowed) {
    res.status(429).json({ error: "rate_limited", message: "Too many orders in a row. Please wait a moment or call the store." });
    return;
  }

  // ---- authoritative pricing from the server catalog (NEVER trust client prices) ----
  const priced = priceLines(clientLines);
  if (!priced.ok) {
    res.status(400).json({ error: "invalid_item", message: priced.reason });
    return;
  }
  const lines: CartLineInput[] = priced.lines;
  const totals = computeTotals(lines, tipCents, paymentMethod === "cash");
  if (totals.total <= 0) {
    res.status(400).json({ error: "empty_order" });
    return;
  }

  if (!cloverConfigured()) {
    res.status(503).json({ error: "ordering_not_configured", message: "Online ordering isn't switched on yet. Please call the store to order." });
    return;
  }

  const cust = {
    name: customer.name.trim(),
    phone: customer.phone.trim(),
    email: customer.email?.trim(),
    address: customer.address?.trim().slice(0, ADDR_MAX),
  };

  // ---- idempotent reservation: atomically claim the key so a retry can't
  //      double-charge or double-fire. Replay/short-circuit if already seen. ----
  const reservation = await reserveOrder({
    idempotencyKey,
    fulfillment,
    customer: cust,
    items: lines,
    subtotal: totals.subtotal,
    tax: totals.tax,
    tip: totals.tip,
    total: totals.total,
    paymentMethod,
  });
  let reservedId: number | null = null;
  if (reservation.reserved === true) {
    reservedId = reservation.id;
  } else if (reservation.reserved === false) {
    const ex = reservation.existing;
    if (ex.cloverOrderId) {
      res.status(200).json({ ok: true, orderId: ex.cloverOrderId, paid: ex.status === "paid", duplicate: true, totals });
      return;
    }
    if (ex.chargeId) {
      res.status(200).json({ ok: true, paid: true, chargeId: ex.chargeId, routingIssue: true, message: "Your payment went through — please call the store to confirm your order." });
      return;
    }
    if (ex.ageSec < 90) {
      res.status(409).json({ error: "processing", message: "This order is already being placed. Please wait a moment before retrying." });
      return;
    }
    // Stale 'pending': a prior attempt started but never durably recorded its
    // outcome (a mid-flight function kill can leave this even AFTER the POS order
    // posted). createPosOrder is not idempotent, so re-firing could double the
    // kitchen ticket. Do NOT re-create — flag staff to verify and ask the
    // customer to call, rather than risk making the food twice.
    await alertStaff(`UNCERTAIN WEB ORDER — ${cust.name} ${maskPhone(cust.phone)} idem ${idempotencyKey.slice(0, 8)} — verify in POS before it is remade.`);
    res.status(409).json({ error: "uncertain", message: "We couldn't confirm your previous attempt went through. Please call the store to check before re-ordering." });
    return;
  }
  // reservation.reserved === null → DB unavailable; proceed fail-open without a stored row.

  // ---- card payment ----
  // Preferred: SINGLE-ORDER flow — build the itemized draft first, verify
  // Clover's computed amount equals ours, charge the card AGAINST that order
  // (payment + line items on one record; no "Item 1" ghost order), then fire.
  // Tip orders and any amount disagreement fall back to the legacy two-order
  // flow (standalone charge first) — the charged amount always matches what
  // the customer was shown; dashboard tidiness never wins over correctness.
  let chargeId: string | undefined;
  let paidOrderId: string | undefined; // set when the single-order flow holds the payment
  if (paymentMethod === "card") {
    if (!cardToken || !cardToken.startsWith("clv_")) {
      res.status(400).json({ error: "card_token_required" });
      return;
    }
    if (totals.total < CARD_MIN_TOTAL) {
      res.status(400).json({ error: "order_too_small", message: "Minimum for card payment is $1.00 — or pay at pickup." });
      return;
    }

    if (totals.tip === 0) {
      let draftId: string | undefined;
      try {
        const draft = await createDraftOrder({
          lines,
          fulfillment,
          note: buildOrderNote({ fulfillment, customer: cust, lines, totals, payment: "card", orderNote }),
        });
        draftId = draft.id;
        const cloverAmount = await getEcommOrderAmount(draftId);
        if (cloverAmount === totals.total) {
          try {
            const charge = await payForOrder({
              orderId: draftId,
              source: cardToken,
              idempotencyKey,
              clientIp: ip,
              email: cust.email,
            });
            chargeId = charge.id;
            paidOrderId = draftId;
            // Persist the capture BEFORE the fire step so a mid-flight kill can't lose it.
            if (reservedId != null) await updateOrder(reservedId, { status: "charged", chargeId, cloverOrderId: draftId });
          } catch (err) {
            // Declined (or gateway error): nothing was charged — remove the
            // draft and fail closed exactly like the legacy flow.
            await deleteDraftOrder(draftId).catch(() => {});
            const status = err instanceof CloverError ? err.status : 500;
            console.error("[order/create] pay-for-order failed", status, err instanceof Error ? err.message : err);
            res.status(status === 503 ? 503 : 402).json({ error: "payment_failed", message: "We couldn't process that card. Please try again or use a different card." });
            return;
          }
        } else {
          console.error(`[order/create] clover amount ${cloverAmount} != ours ${totals.total} — two-order fallback`);
          await deleteDraftOrder(draftId).catch(() => {});
        }
      } catch (err) {
        // Draft creation / amount lookup failed pre-charge — fall back to the
        // proven two-order flow rather than losing the sale.
        console.error("[order/create] single-order setup failed — two-order fallback", err instanceof Error ? err.message : err);
        if (draftId && !chargeId) await deleteDraftOrder(draftId).catch(() => {});
      }
    }

    if (!chargeId) {
      // Legacy two-order flow (fails closed: no charge → no order).
      try {
        const charge = await createCharge({
          amount: totals.total,
          source: cardToken,
          taxAmount: totals.tax,
          idempotencyKey,
          clientIp: ip,
          email: cust.email,
          description: `Gigi's Long Branch web order — ${cust.name}`,
        });
        chargeId = charge.id;
        // Persist the capture BEFORE the POS step so a mid-flight kill can't lose it.
        if (reservedId != null) await updateOrder(reservedId, { status: "charged", chargeId });
      } catch (err) {
        const status = err instanceof CloverError ? err.status : 500;
        console.error("[order/create] charge failed", status, err instanceof Error ? err.message : err);
        res.status(status === 503 ? 503 : 402).json({ error: "payment_failed", message: "We couldn't process that card. Please try again or use a different card." });
        return;
      }
    }
  }

  // ---- single-order flow: payment already on the itemized order — fire it ----
  if (paidOrderId) {
    const note = buildOrderNote({ fulfillment, customer: cust, lines, totals, payment: "card", chargeId, orderNote });
    try {
      await fireOrder(paidOrderId, { paid: true, note });
      if (reservedId != null) await updateOrder(reservedId, { status: "paid", cloverOrderId: paidOrderId, note });
      await sendOrderReceipt({ email: cust.email, name: cust.name, fulfillment, address: cust.address, lines, totals, paymentMethod, orderId: paidOrderId });
      res.status(200).json({ ok: true, orderId: paidOrderId, paid: true, chargeId, totals });
    } catch (err) {
      // Paid but not fired: the payment and items live on the SAME order, so
      // staff recovery is just opening that order in the POS. Never delete it.
      console.error("[order/create] fire failed after payment", err);
      if (reservedId != null) await updateOrder(reservedId, { status: "paid_unrouted", note });
      await alertStaff(`PAID WEB ORDER NOT FIRED — ${cust.name} ${maskPhone(cust.phone)} $${(totals.total / 100).toFixed(2)} — Clover order ${paidOrderId} holds the payment but didn't fire; open it in the POS.`);
      res.status(200).json({ ok: true, paid: true, chargeId, routingIssue: true, message: "Your payment went through, but please call the store to confirm your order was received." });
    }
    return;
  }

  // ---- drop the order into the POS / kitchen (atomic) ----
  const note = buildOrderNote({ fulfillment, customer: cust, lines, totals, payment: paymentMethod, chargeId, orderNote });
  try {
    const order = await createPosOrder({
      lines,
      fulfillment,
      note,
      paid: paymentMethod === "card",
      discountCents: totals.discount,
    });
    if (reservedId != null) await updateOrder(reservedId, { status: paymentMethod === "card" ? "paid" : "placed", cloverOrderId: order.id, note });
    await sendOrderReceipt({ email: cust.email, name: cust.name, fulfillment, address: cust.address, lines, totals, paymentMethod, orderId: order.id });
    res.status(200).json({ ok: true, orderId: order.id, paid: paymentMethod === "card", chargeId, totals });
  } catch (err) {
    console.error("[order/create] POS order failed", err);
    if (chargeId) {
      // Card captured but the kitchen ticket didn't post. Durable record + staff
      // alert so the paid order is recovered — never depend on the customer calling.
      if (reservedId != null) await updateOrder(reservedId, { status: "paid_unrouted", note });
      await alertStaff(`PAID WEB ORDER NOT IN POS — ${cust.name} ${maskPhone(cust.phone)} $${(totals.total / 100).toFixed(2)} charge ${chargeId}. Recover manually.`);
      res.status(200).json({ ok: true, paid: true, chargeId, routingIssue: true, message: "Your payment went through, but please call the store to confirm your order was received." });
      return;
    }
    if (reservedId != null) await updateOrder(reservedId, { status: "failed", note });
    res.status(502).json({ error: "order_routing_failed", message: "We couldn't send your order to the kitchen. Please call the store to order." });
  }
}
