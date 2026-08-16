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
  getOrderPaymentId,
  payForOrder,
  printOrderTicket,
  ticketTitle,
  CloverError,
  MAX_UNITS,
  unitPrice,
  type CartLineInput,
  type Fulfillment,
  type Totals,
} from "../lib/clover.js";
import { priceLines, type ClientLine } from "../lib/menuCatalog.js";
import { liveItemNames } from "../lib/menuLive.js";
import { isOrderingOpen, isDeliveryOpen } from "../../src/lib/openStatus.js";
import { rateLimitAll } from "../lib/rateLimit.js";
import { peekOrder, releaseOrder, reserveOrder, updateOrder, updateOrderStrict } from "../lib/orderStore.js";
import { applyFreePie, checkPromoCode, claimPromoCode, normalizePromoCode, redeemPromoCode, releasePromoCode } from "../lib/promo.js";
import { alertStaff, sendReceiptEmail } from "../lib/notify.js";
import { receiptHtml } from "../lib/emailTemplate.js";
import { verifyTurnstile } from "../lib/turnstile.js";
import { isVipMember } from "../lib/vipLookup.js";
import { countUnits, readyMessage } from "../../src/lib/readyTime.js";
import { deliveryFeeCents, isDeliveryTown } from "../../src/lib/deliveryZones.js";
import { placementSuffix } from "../../src/data/menuToppings.js";
import { clientTotalMatches } from "../lib/orderSafety.js";
import { replayOrder } from "../lib/orderReplay.js";
import { isDefinitelyDeclined } from "../lib/paymentRetry.js";

/**
 * The receipt's "join the VIP Club" button, pointed at the standalone signup page
 * with the order's own details in the query string.
 *
 * The customer just typed all of this to order; sending them to an empty form is
 * what the old #vip-club link cost us. The page only writes these into its inputs
 * (still editable) — the server re-validates everything and the consent boxes stay
 * unchecked, so a forwarded receipt can't opt anybody in.
 */
function vipJoinUrl(o: { name: string; phone?: string; email?: string; fulfillment: Fulfillment; address?: string }): string {
  const base = process.env.PUBLIC_BASE_URL || "https://gigislongbranch.com";
  const q = new URLSearchParams({ name: o.name, src: "receipt" });
  if (o.phone) q.set("phone", o.phone);
  if (o.email) q.set("email", o.email);
  // Pickup orders carry no address, and the welcome pie is one per household.
  if (o.fulfillment === "delivery" && o.address) q.set("address", o.address);
  return `${base}/vip-club/?${q.toString()}`;
}

/** Best-effort branded receipt email — env-gated, never blocks or fails the order. */
async function sendOrderReceipt(o: {
  email?: string;
  name: string;
  phone?: string;
  fulfillment: Fulfillment;
  address?: string;
  lines: CartLineInput[];
  totals: Totals;
  paymentMethod: "card" | "pickup" | "cash";
  orderId: string;
  /** Show the free-pie VIP invite (only for non-members). */
  vipPitch?: boolean;
}): Promise<void> {
  if (!o.email) return;
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  // Card is the only payment method a website order can have (see the prepay gate in the handler).
  const paymentLine = `Paid online — ${money(o.totals.total)} charged to your card.`;
  try {
    const html = receiptHtml({
      customerName: o.name,
      fulfillment: o.fulfillment,
      orderRef: o.orderId.slice(-8).toUpperCase(),
      address: o.address,
      lines: o.lines.map((l) => ({
        quantity: l.quantity,
        name: l.itemName,
        options: l.options.map((x) => x.name + placementSuffix(x.placement)).join(", ") || undefined,
        lineTotal: money(unitPrice(l) * l.quantity),
      })),
      subtotal: money(o.totals.subtotal),
      discount: o.totals.discount ? `\u2212${money(o.totals.discount)}` : undefined,
      deliveryFee: o.totals.deliveryFee ? money(o.totals.deliveryFee) : undefined,
      tax: money(o.totals.tax),
      tip: o.totals.tip ? money(o.totals.tip) : undefined,
      total: money(o.totals.total),
      paymentLine,
      readyLine: readyMessage(countUnits(o.lines), o.fulfillment),
      vipPitch: o.vipPitch,
      vipJoinUrl: o.vipPitch ? vipJoinUrl(o) : undefined,
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
const ORDER_NOTE_MAX = 130;

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
      // `notes` reaches a template literal in buildOrderNote. An object whose
      // toString is null makes that interpolation throw, and the throw lands
      // AFTER the card is captured — money taken, no POS order, no ticket, no
      // alert. Shape-check it here, where rejecting costs nothing.
      (l.notes == null || (typeof l.notes === "string" && l.notes.length <= 500)) &&
      (l.options == null ||
        (Array.isArray(l.options) &&
          l.options.length <= MAX_OPTS_PER_LINE &&
          l.options.every((o: unknown) => {
            const opt = o as { name?: unknown; group?: unknown; placement?: unknown };
            return (
              opt &&
              typeof opt.name === "string" &&
              (opt.group == null || typeof opt.group === "string") &&
              (opt.placement == null || opt.placement === "whole" || opt.placement === "left" || opt.placement === "right")
            );
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

  // ---- store hours gate (authoritative; the checkout UI mirrors it) ----
  // 5-minute grace so a checkout in flight at closing time isn't failed mid-payment.
  if (!isOrderingOpen(5)) {
    res.status(409).json({
      error: "store_closed",
      message: "Gigi's is closed right now — online ordering is open daily from 10 AM until close (11 PM Mon–Wed, midnight Thu–Sun). See you when we open!",
    });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const fulfillment = body.fulfillment as Fulfillment;
  const customer = (body.customer ?? {}) as { name?: string; phone?: string; email?: string; address?: string; town?: string };
  // PREPAID ONLY (2026-08-11, owner's call after an order was placed and never collected):
  // every website order is charged before it reaches the kitchen. "pickup" (card on collection)
  // and "cash" are gone. Enforced HERE and not merely hidden in the UI — otherwise a crafted POST
  // could still book food nobody has paid for.
  const paymentMethod: "card" = "card";
  if (body.paymentMethod !== undefined && body.paymentMethod !== "card") {
    res.status(400).json({
      error: "prepay_required",
      message: "Online orders are paid by card when you place them. Please reload the page, or call the store to order.",
    });
    return;
  }
  const cardToken = typeof body.cardToken === "string" ? body.cardToken : undefined;
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : undefined;
  const tipCents = Number.isFinite(body.tipCents) ? Number(body.tipCents) : 0;
  const expectedTotal = body.expectedTotal;
  const orderNote = typeof body.orderNote === "string" ? body.orderNote : undefined;
  const promoCodeRaw = typeof body.promoCode === "string" ? body.promoCode.trim() : "";

  // ---- validate shape ----
  if (fulfillment !== "pickup" && fulfillment !== "delivery") {
    res.status(400).json({ error: "invalid_fulfillment" });
    return;
  }
  if (orderNote != null && orderNote.length > ORDER_NOTE_MAX) {
    res.status(400).json({ error: "order_note_too_long", message: "Please shorten the order note to 130 characters." });
    return;
  }
  // In-house delivery stops at 10 PM even on nights the kitchen runs later — the drivers are
  // done. Same 5-minute grace as the store-hours gate so a checkout already in flight at 9:59
  // isn't failed mid-payment. Pickup is unaffected and stays open until close.
  if (fulfillment === "delivery" && !isDeliveryOpen(5)) {
    res.status(409).json({
      error: "delivery_closed",
      message: "Delivery stops at 10 PM. Pickup is still available until we close — switch to pickup and we'll have it ready.",
    });
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
  // Email is REQUIRED so every website order gets an emailed receipt.
  if (typeof customer.email !== "string" || customer.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim())) {
    res.status(400).json({ error: "valid_email_required", message: "Please enter a valid email so we can send your receipt." });
    return;
  }
  if (
    fulfillment === "delivery" &&
    (typeof customer.address !== "string" || customer.address.trim().length < 5 || customer.address.length > ADDR_MAX)
  ) {
    res.status(400).json({ error: "delivery_address_required" });
    return;
  }
  // The delivery fee is keyed off the town, so an unknown town must be rejected rather than
  // defaulted — guessing would charge the wrong amount. Also stops orders to towns Gigi's
  // doesn't cover.
  if (fulfillment === "delivery" && !isDeliveryTown(customer.town)) {
    res.status(400).json({
      error: "delivery_town_required",
      message: "Please choose your town so we can add the right delivery fee.",
    });
    return;
  }
  // Promo format + pickup-only are cheap stateless checks, so they run with the other shape
  // validations — before any DB work or the bot check. The code's actual validity (exists,
  // unredeemed, unexpired) is checked after pricing, where the cart is known.
  const promoCode = promoCodeRaw ? normalizePromoCode(promoCodeRaw) : null;
  if (promoCodeRaw && !promoCode) {
    res.status(400).json({ error: "promo_invalid", message: "That code doesn't look right — check it and try again." });
    return;
  }
  if (promoCode && fulfillment !== "pickup") {
    res.status(400).json({
      error: "promo_pickup_only",
      message: "The free welcome pie is for pickup orders only — switch to pickup to use your code.",
    });
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
  let prior;
  try {
    prior = await peekOrder(idempotencyKey);
  } catch (err) {
    console.error("[order/create] order store unavailable before payment", err);
    res.status(503).json({ error: "ordering_temporarily_unavailable", message: "Online ordering is temporarily unavailable. Please call the store to order." });
    return;
  }
  // 'charged' means the card was taken but the order had not fired yet — it is
  // still a draft, so it is in no POS and no ticket printed. Reporting that as a
  // finished order hands the customer a confirmation for food nobody is making,
  // so it takes the routing-issue path and pages staff instead.
  if (prior && replayOrder(prior).kind === "routing_issue") {
    await alertStaff(`PAID WEB ORDER NOT FIRED — retry seen for Clover order ${prior?.cloverOrderId ?? "?"} charge ${prior?.chargeId ?? "?"}; open it in the POS.`);
    // These states only occur after a confirmed capture, so the customer must not
    // submit another payment while staff recovers the kitchen routing.
    res.status(200).json({
      ok: true,
      orderId: prior?.cloverOrderId,
      paid: true,
      chargeId: prior?.chargeId,
      routingIssue: true,
      message: "Your payment went through, but please call the store to confirm your order was received.",
    });
    return;
  }
  if (prior && replayOrder(prior).kind === "completed") {
    res.status(200).json({ ok: true, orderId: prior.cloverOrderId, paid: prior.status === "paid", duplicate: true });
    return;
  }
  if (prior && replayOrder(prior).kind === "uncertain") {
    await alertStaff(`UNCERTAIN WEB ORDER — retry seen for Clover order ${prior.cloverOrderId ?? "?"}; verify payment and order state before remaking.`);
    res.status(409).json({ error: "uncertain", message: "We couldn't confirm your previous attempt. Please call the store before re-ordering so you aren't charged twice." });
    return;
  }
  if (prior && replayOrder(prior).kind === "processing") {
    res.status(409).json({ error: "processing", message: "This order is already being placed. Please wait a moment before retrying." });
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
  // Items pulled off Clover since this build are rejected here too, so a page
  // cached before the nightly refresh can't order something the kitchen dropped.
  const priced = priceLines(clientLines, await liveItemNames());
  if (!priced.ok) {
    res.status(400).json({ error: "invalid_item", message: priced.reason });
    return;
  }
  const lines: CartLineInput[] = priced.lines;
  // Fee resolved from the validated town by the shared schedule — never from the client.
  const fee = deliveryFeeCents(fulfillment, customer.town);
  if (fee === null) {
    res.status(400).json({ error: "delivery_town_required" });
    return;
  }
  // ---- VIP free-pie promo (already known to be pickup-only by here) ----
  // The discount is server-derived: the catalog base price of the Plain Pie actually in the cart.
  // The client only ever sends the code. `kitchenLines` is what Clover, the ticket and the receipt
  // see — identical to `lines` except one Plain Pie unit is zero-priced (see applyFreePie).
  let promo: { id: number; code: string } | null = null;
  let discount = 0;
  let kitchenLines: CartLineInput[] = lines;
  if (promoCode) {
    const check = await checkPromoCode("gigis_long_branch", promoCode);
    if (!check.ok) {
      res.status(400).json({ error: "promo_invalid", message: check.message });
      return;
    }
    const applied = applyFreePie(lines, check.code);
    if (!applied) {
      res.status(400).json({
        error: "promo_needs_pie",
        message: "Your code is for a free Plain Pie — add a Plain Pie to your order to use it.",
      });
      return;
    }
    promo = { id: check.id, code: check.code };
    discount = applied.discountCents;
    kitchenLines = applied.lines;
  }
  const totals = computeTotals(lines, tipCents, fee, discount);
  // The browser may have been left open across a menu-price deployment. Never charge the
  // server's newer total until the customer has actually seen it. This check happens before the
  // reservation, Clover draft, or any payment side effect. A cached pre-check client that does
  // not send expectedTotal is also stopped and told to reload.
  if (!clientTotalMatches(expectedTotal, totals.total)) {
    res.status(409).json({
      error: "total_changed",
      message: "Your order total changed while checkout was open. Please reload the page, review the updated total, and try again.",
      totals,
    });
    return;
  }
  if (totals.total <= 0) {
    // Reachable without an empty cart: a free-pie promo zero-prices the Plain Pie and tax is
    // computed after the discount, so a cart holding only the free pie totals exactly $0.00.
    // With no message the client rendered the raw key — the banner read "empty_order".
    res.status(400).json({
      error: "empty_order",
      message:
        "Your total comes to $0.00 — add anything else to the order, or just come in and pick up your free pie.",
    });
    return;
  }
  // Finalizes the reservation after the order lands with confirmed payment. The
  // atomic claim below already prevents a second order from receiving the same discount.
  const redeemPromo = async (orderRef: string) => {
    if (!promo) return;
    try {
      const first = await redeemPromoCode(promo.id, idempotencyKey);
      if (!first) {
        console.error(`[order/create] promo ${promo.code} already redeemed when order ${orderRef} completed`);
        await alertStaff(`FREE PIE CODE ${promo.code} landed on two orders at once — order ${orderRef} also got the free pie; flag for Tommy.`);
      }
    } catch (err) {
      console.error("[order/create] promo redemption failed", err);
    }
  };

  if (!cloverConfigured()) {
    res.status(503).json({ error: "ordering_not_configured", message: "Online ordering isn't switched on yet. Please call the store to order." });
    return;
  }

  // Reject request-shape failures before claiming either the order key or a one-time promo.
  if (!cardToken || !cardToken.startsWith("clv_")) {
    res.status(400).json({ error: "card_token_required" });
    return;
  }
  if (totals.total < CARD_MIN_TOTAL) {
    res.status(400).json({ error: "order_too_small", message: "Card orders have a $1.00 minimum — please add an item." });
    return;
  }

  const cust = {
    name: customer.name.trim(),
    phone: customer.phone.trim(),
    email: customer.email?.trim(),
    address: customer.address?.trim().slice(0, ADDR_MAX),
    town: isDeliveryTown(customer.town) ? customer.town : undefined,
  };

  // ---- idempotent reservation: atomically claim the key so a retry can't
  //      double-charge or double-fire. Replay/short-circuit if already seen. ----
  const reservation = await reserveOrder({
    idempotencyKey,
    fulfillment,
    customer: cust,
    items: kitchenLines,
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
    const replay = replayOrder(ex);
    if (replay.kind === "routing_issue") {
      await alertStaff(`PAID WEB ORDER NOT FIRED — retry seen for Clover order ${ex.cloverOrderId ?? "?"} charge ${ex.chargeId ?? "?"}; open it in the POS.`);
      // These states only occur after a confirmed capture, so the customer must not
      // submit another payment while staff recovers the kitchen routing.
      res.status(200).json({
        ok: true,
        orderId: ex.cloverOrderId,
        paid: true,
        chargeId: ex.chargeId,
        routingIssue: true,
        message: "Your payment went through, but please call the store to confirm your order was received.",
      });
      return;
    }
    if (replay.kind === "completed") {
      res.status(200).json({ ok: true, orderId: ex.cloverOrderId, paid: ex.status === "paid", duplicate: true, totals });
      return;
    }
    if (replay.kind === "processing") {
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
  if (reservation.reserved === null) {
    res.status(503).json({ error: "ordering_temporarily_unavailable", message: "Online ordering is temporarily unavailable. Please call the store to order." });
    return;
  }

  // The code is claimed atomically before Clover sees the order. A second order cannot receive
  // the same discount while this one is charging; only a definite no-charge result releases it.
  if (promo) {
    let claimed = false;
    try {
      claimed = await claimPromoCode(promo.id, idempotencyKey);
    } catch (err) {
      console.error("[order/create] promo claim failed", err);
    }
    if (!claimed) {
      if (reservedId != null) await releaseOrder(reservedId);
      res.status(409).json({ error: "promo_in_use", message: "That code is already being used by another order. Please check your prior order or remove the code." });
      return;
    }
  }

  const releasePromo = async () => {
    if (!promo) return;
    try {
      await releasePromoCode(promo.id, idempotencyKey);
    } catch (err) {
      console.error("[order/create] promo release failed", err);
    }
  };

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
    {
      // ONE Clover order per website order: create the itemized order, then pay
      // THAT order (tip rides along via tip_amount, so a tipped order no longer
      // falls back to the old two-order flow). The order therefore carries both
      // the items and the payment, and shows as PAID on the POS screen.
      const orderAmount = totals.total - totals.tip; // what Clover computes: items + tax
      let draftId: string | undefined;
      try {
        const draft = await createDraftOrder({
          lines: kitchenLines,
          fulfillment,
          deliveryFee: totals.deliveryFee,
          note: buildOrderNote({ fulfillment, customer: cust, lines: kitchenLines, totals, payment: "card", orderNote }),
        });
        draftId = draft.id;
        // Record the draft BEFORE the money moves. If the function is killed inside /pay, this
        // row is the only pointer to an order that may be holding a capture — and a paid draft
        // does not appear in the POS Orders screen, so with no pointer there is nothing to look
        // up. releaseOrder({draftDiscarded}) undoes it on the paths that delete the draft.
        if (reservedId != null) await updateOrderStrict(reservedId, { cloverOrderId: draftId });
        const cloverAmount = await getEcommOrderAmount(draftId);
        if (cloverAmount === orderAmount) {
          try {
            // No email passed: Clover would send its own bare payment receipt
            // on top of our branded order confirmation — one receipt is enough.
            const charge = await payForOrder({
              orderId: draftId,
              source: cardToken,
              idempotencyKey,
              clientIp: ip,
              tipAmount: totals.tip || undefined,
            });
            // /pay has now explicitly confirmed the capture. Persist that fact before any
            // optional tender lookup; a later REST 404 is not a card decline.
            chargeId = charge.id;
            paidOrderId = draftId;
            if (reservedId != null) await updateOrderStrict(reservedId, { status: "charged", chargeId, cloverOrderId: draftId });
            try {
              const paymentId = await getOrderPaymentId(draftId);
              if (paymentId) {
                chargeId = paymentId;
                if (reservedId != null) await updateOrderStrict(reservedId, { chargeId: paymentId });
              }
            } catch (lookupErr) {
              // The order itself still holds the confirmed payment. Keep going and use the order
              // id as the recovery reference instead of opening a retry/double-charge path.
              console.error("[order/create] confirmed payment tender lookup failed", lookupErr);
            }
          } catch (err) {
            const status = err instanceof CloverError ? err.status : 500;
            // A 4xx from Clover is a DEFINITE decline: it answered, and it refused. Anything else
            // — a network drop, a function timeout, a 5xx — is UNCERTAIN: Clover may well have
            // captured the money and lost the response on the way back.
            //
            // Treating uncertain as "nothing was charged" is how a capture goes silent: the code
            // used to delete the order holding the payment, release the key, write no record and
            // fire no alert, while telling the customer their card failed. The money is gone, no
            // ticket prints, and nobody at the shop knows until the chargeback.
            const definitelyDeclined = isDefinitelyDeclined(err);

            if (!definitelyDeclined) {
              // Keep the order — it may hold the payment. Keep the reservation so a retry can't
              // double-charge. Page staff to reconcile it in the POS.
              console.error("[order/create] pay-for-order UNCERTAIN — preserving order", status, err instanceof Error ? err.message : err);
              if (reservedId != null) {
                await updateOrder(reservedId, { status: "capture_uncertain", cloverOrderId: draftId });
              }
              // Keep the promo RESERVED, not redeemed. That prevents reuse while staff checks
              // Clover without permanently burning it if no payment actually landed.
              await alertStaff(
                `UNCERTAIN CARD RESULT — ${cust.name} ${maskPhone(cust.phone)} $${(totals.total / 100).toFixed(2)} — ` +
                `Clover order ${draftId} may hold a payment but we never got a confirmation. ` +
                `Open it in the POS: if it is paid, make the order; if not, it can be voided.` +
                (promo ? ` Free-pie code ${promo.code} remains on hold; release it in Admin only if no payment landed.` : ""),
              );
              res.status(200).json({
                ok: true,
                orderId: draftId,
                paid: false,
                routingIssue: true,
                message: "We couldn't confirm your payment. Please call the store before re-ordering so we don't charge you twice.",
              });
              return;
            }

            // Definite decline: nothing was captured, so it is safe to clean up.
            await deleteDraftOrder(draftId).catch(() => {});
            // Hand the key back — otherwise the customer we just told to "try a different card"
            // cannot, because the reservation from the first attempt blocks every retry.
            if (reservedId != null) await releaseOrder(reservedId, { draftDiscarded: true });
            await releasePromo();
            console.error("[order/create] pay-for-order declined", status, err instanceof Error ? err.message : err);
            res.status(402).json({ error: "payment_failed", message: "We couldn't process that card. Please try again or use a different card." });
            return;
          }
        } else {
          console.error(`[order/create] clover order amount ${cloverAmount} != items+tax ${orderAmount} — two-order fallback`);
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
        // No email passed — suppresses Clover's duplicate payment receipt;
        // our branded order confirmation is the single receipt.
        const charge = await createCharge({
          amount: totals.total,
          source: cardToken,
          taxAmount: totals.tax,
          idempotencyKey,
          clientIp: ip,
          description: `Gigi's Long Branch web order — ${cust.name}`,
        });
        chargeId = charge.id;
        // Persist the capture BEFORE the POS step so a mid-flight kill can't lose it.
        if (reservedId != null) await updateOrderStrict(reservedId, { status: "charged", chargeId });
      } catch (err) {
        const status = err instanceof CloverError ? err.status : 500;
        // Same discipline as the single-order path: only a DEFINITE 4xx decline may clean up
        // and invite a retry. Anything else — capture_uncertain (502), a network drop, a
        // Clover 5xx — may have captured money, so the reservation is KEPT, staff are paged,
        // and the customer is told NOT to re-order. This catch previously released the key
        // unconditionally, which was the last surviving copy of the incident pattern that
        // charged one customer five times on 2026-08-15.
        const definitelyDeclined = isDefinitelyDeclined(err);
        if (!definitelyDeclined) {
          console.error("[order/create] fallback charge UNCERTAIN — keeping reservation", status, err instanceof Error ? err.message : err);
          if (reservedId != null) await updateOrder(reservedId, { status: "capture_uncertain" });
          // The promo remains reserved until staff confirms whether the capture landed.
          await alertStaff(
            `UNCERTAIN CARD RESULT (fallback) — ${cust.name} ${maskPhone(cust.phone)} $${(totals.total / 100).toFixed(2)} — ` +
            `the charge may have captured but we never got a clean answer. Check Clover payments before re-charging.` +
            (promo ? ` Free-pie code ${promo.code} remains on hold; release it in Admin only if nothing captured.` : ""),
          );
          res.status(200).json({
            ok: true,
            paid: false,
            routingIssue: true,
            message: "We couldn't confirm your payment. Please call the store before re-ordering so we don't charge you twice.",
          });
          return;
        }
        // Definite decline: nothing captured, so it is safe to release the key for a retry.
        // draftDiscarded: a draft from the abandoned single-order attempt may still be recorded
        // on this row, and it was deleted before the fallback ran.
        if (reservedId != null) await releaseOrder(reservedId, { draftDiscarded: true });
        await releasePromo();
        console.error("[order/create] charge declined", status, err instanceof Error ? err.message : err);
        res.status(402).json({ error: "payment_failed", message: "We couldn't process that card. Please try again or use a different card." });
        return;
      }
    }
  }

  // ---- single-order flow: payment already on the itemized order — fire it ----
  if (paidOrderId) {
    const note = buildOrderNote({ fulfillment, customer: cust, lines: kitchenLines, totals, payment: "card", chargeId, orderNote });
    try {
      await fireOrder(paidOrderId, { paid: true, note, title: ticketTitle(fulfillment, true) });
      if (reservedId != null) await updateOrder(reservedId, { status: "paid", cloverOrderId: paidOrderId, note });
      // Kitchen ticket: firing only makes the order visible in the POS — this is
      // what drives the printer. Awaited (not fire-and-forget) so it isn't killed
      // by the serverless function freezing after the response; never throws.
      // A failed print job cannot be replayed later, and the order is already paid,
      // so a silent failure is exactly the "customer shows up, nobody made it" case
      // prepaid ordering exists to prevent — page staff instead of only logging.
      const ticket = await printOrderTicket(paidOrderId);
      if (!ticket.printed) {
        await alertStaff(
          `KITCHEN TICKET DID NOT PRINT — ${cust.name} ${maskPhone(cust.phone)} $${(totals.total / 100).toFixed(2)} — ` +
          `Clover order ${paidOrderId} is PAID and open in the POS, but no ticket came out (${ticket.error ?? ticket.state ?? "unknown"}). Print it from the POS.`,
        );
      }
      await redeemPromo(paidOrderId);
      // Invite non-members to the free-pie club — on the confirmation popup
      // and in the receipt. Existing members are skipped.
      const vipEligible = !(await isVipMember("gigis_long_branch", `+1${phoneIdentity(cust.phone)}`, cust.email ?? null));
      await sendOrderReceipt({ email: cust.email, name: cust.name, phone: cust.phone, fulfillment, address: cust.address, lines: kitchenLines, totals, paymentMethod, orderId: paidOrderId, vipPitch: vipEligible });
      res.status(200).json({ ok: true, orderId: paidOrderId, paid: true, chargeId, totals, vipEligible });
    } catch (err) {
      // Paid but not fired: the payment and items live on the SAME order, so
      // staff recovery is just opening that order in the POS. Never delete it.
      console.error("[order/create] fire failed after payment", err);
      await redeemPromo(paidOrderId);
      if (reservedId != null) await updateOrder(reservedId, { status: "paid_unrouted", note });
      await alertStaff(`PAID WEB ORDER NOT FIRED — ${cust.name} ${maskPhone(cust.phone)} $${(totals.total / 100).toFixed(2)} — Clover order ${paidOrderId} holds the payment but didn't fire; open it in the POS.`);
      res.status(200).json({ ok: true, paid: true, chargeId, routingIssue: true, message: "Your payment went through, but please call the store to confirm your order was received." });
    }
    return;
  }

  // ---- drop the order into the POS / kitchen (atomic) ----
  const note = buildOrderNote({ fulfillment, customer: cust, lines: kitchenLines, totals, payment: paymentMethod, chargeId, orderNote });
  try {
    const order = await createPosOrder({
      lines: kitchenLines,
      fulfillment,
      note,
      paid: paymentMethod === "card",
      deliveryFee: totals.deliveryFee,
    });
    if (reservedId != null) await updateOrder(reservedId, { status: paymentMethod === "card" ? "paid" : "placed", cloverOrderId: order.id, note });
    // Kitchen ticket for the prepaid website order.
    const ticket = await printOrderTicket(order.id);
    if (!ticket.printed) {
      await alertStaff(
        `KITCHEN TICKET DID NOT PRINT — ${cust.name} ${maskPhone(cust.phone)} $${(totals.total / 100).toFixed(2)} — ` +
        `Clover order ${order.id} is in the POS but no ticket came out (${ticket.error ?? ticket.state ?? "unknown"}). Print it from the POS.`,
      );
    }
    await redeemPromo(order.id);
    const vipEligible = !(await isVipMember("gigis_long_branch", `+1${phoneIdentity(cust.phone)}`, cust.email ?? null));
    await sendOrderReceipt({ email: cust.email, name: cust.name, phone: cust.phone, fulfillment, address: cust.address, lines: kitchenLines, totals, paymentMethod, orderId: order.id, vipPitch: vipEligible });
    res.status(200).json({ ok: true, orderId: order.id, paid: paymentMethod === "card", chargeId, totals, vipEligible });
  } catch (err) {
    console.error("[order/create] POS order failed", err);
    if (chargeId) {
      // Card captured but the kitchen ticket didn't post. Durable record + staff
      // alert so the paid order is recovered — never depend on the customer calling.
      await redeemPromo(chargeId);
      if (reservedId != null) await updateOrder(reservedId, { status: "paid_unrouted", note });
      await alertStaff(`PAID WEB ORDER NOT IN POS — ${cust.name} ${maskPhone(cust.phone)} $${(totals.total / 100).toFixed(2)} charge ${chargeId}. Recover manually.`);
      res.status(200).json({ ok: true, paid: true, chargeId, routingIssue: true, message: "Your payment went through, but please call the store to confirm your order was received." });
      return;
    }
    if (reservedId != null) {
      await updateOrder(reservedId, { status: "failed", note });
      // Release the key as both card paths do. reserveOrder is ON CONFLICT DO NOTHING with
      // no TTL and no cleanup job, so without this the dead row blocked every retry of the
      // same cart forever: a transient Clover blip became a permanent 409 ("already being
      // placed", which is false). releaseOrder no-ops if a charge or POS order did land.
      await releaseOrder(reservedId);
    }
    await releasePromo();
    res.status(502).json({ error: "order_routing_failed", message: "We couldn't send your order to the kitchen. Please call the store to order." });
  }
}
