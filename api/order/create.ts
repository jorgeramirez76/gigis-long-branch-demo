import { clientIp } from "../lib/requestIp.js";
import { readSession } from "../lib/session.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  buildOrderNote,
  cloverConfigured,
  cloverRetryBudget,
  computeTotals,
  createDraftOrder,
  deleteDraftOrder,
  fireOrder,
  getEcommOrderAmount,
  getOrderPaymentId,
  payForOrder,
  printOrderTicket,
  CHECKOUT_PRINT_POLL_DELAYS_MS,
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
import { closedTodayMessage, isOrderingOpen, isDeliveryOpen } from "../../src/lib/openStatus.js";
import { claimWindow, rateLimit, rateLimitAll } from "../lib/rateLimit.js";
import { peekOrder, releaseOrder, reserveOrder, settleQueuedPrint, updateOrder, updateOrderStrict } from "../lib/orderStore.js";
import { applyFreePie, claimPromoCode, isFreePickupOrder, normalizePromoCode, redeemPromoCode, releasePromoCode } from "../lib/promo.js";
import { applyBogoPizza, applyPizzaPercent, normalizeCampaignCode, recordCampaignRedemption, resolvePromo } from "../lib/campaignPromo.js";
import { alertOpsOnce, alertStaffOnce, alertStaff, sendReceiptEmail, STAFF_PAGE_COOLDOWN_SEC } from "../lib/notify.js";
import { receiptHtml } from "../lib/emailTemplate.js";
import { verifyTurnstile } from "../lib/turnstile.js";
import { lookupVipCustomer } from "../lib/vipLookup.js";
import { parseVipJoinWith } from "../lib/vipCheckoutJoin.js";
import { addressDedupeKey, legacyAddressDedupeKey } from "../lib/address.js";
import { normalizePhone, US_PHONE_RE } from "../lib/phone.js";
import { validateVipConsentAndLocality } from "../lib/vipValidation.js";
import { CANONICAL_CONSENT_TEXT, parkPendingSignupAndSendLink, type ValidatedSignup } from "../lib/vipSignupShared.js";
import { countUnits, readyMessage } from "../../src/lib/readyTime.js";
import { deliveryFeeCents, isDeliveryTown } from "../../src/lib/deliveryZones.js";
import { placementSuffix } from "../../src/data/menuToppings.js";
import { clientTotalMatches } from "../lib/orderSafety.js";
import { replayOrder } from "../lib/orderReplay.js";
import { isDefinitelyDeclined } from "../lib/paymentRetry.js";
import { CARD_DECLINE_ALERT_ABOVE, CARD_DECLINE_BUCKET, CARD_DECLINE_WINDOW_SEC } from "../lib/cardDeclines.js";

/**
 * The receipt's "join the VIP Club" button: the rewards signup, tagged as coming from a receipt.
 *
 * NO personal data in the URL. It used to carry the customer's name, phone, email and delivery
 * address to the retired /vip-club/ page, which now only redirects to /account/ — the account
 * page never reads those fields (it prefills from sessionStorage), so they did nothing except
 * land in logs, link scanners and forwarded emails. The redirect also stamped every receipt
 * signup source=menu-qr, crediting the printed-menu QR code; source=receipt keeps them apart.
 */
function vipJoinUrl(): string {
  const base = process.env.PUBLIC_BASE_URL || "https://gigislongbranch.com";
  return `${base}/account/?join=1&source=receipt`;
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
  paymentMethod: "card" | "pickup" | "cash" | "free";
  orderId: string;
  /** Show the free-pie VIP invite (only for non-members). */
  vipPitch?: boolean;
}): Promise<void> {
  if (!o.email) return;
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  // Card is the only payment method a website order can have (see the prepay gate in the handler),
  // except an order a promo brought to $0.00, which has nothing to pay at all.
  const paymentLine = o.paymentMethod === "free"
    ? "Nothing to pay — this one's on us. Just come pick it up."
    : `Paid online — ${money(o.totals.total)} charged to your card.`;
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
      cardPricing: o.totals.cardPricing ? money(o.totals.cardPricing) : undefined,
      deliveryFee: o.totals.deliveryFee ? money(o.totals.deliveryFee) : undefined,
      tax: money(o.totals.tax),
      tip: o.totals.tip ? money(o.totals.tip) : undefined,
      total: money(o.totals.total),
      paymentLine,
      readyLine: readyMessage(countUnits(o.lines), o.fulfillment),
      vipPitch: o.vipPitch,
      vipJoinUrl: o.vipPitch ? vipJoinUrl() : undefined,
    });
    const r = await sendReceiptEmail(o.email, `Order received — Gigi's NY Style Pizza (${money(o.totals.total)})`, html);
    if (!r.sent && r.error !== "email_not_configured") console.error("[order/create] receipt email failed:", r.error);
  } catch (e) {
    console.error("[order/create] receipt email error", e);
  }
}

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


/** What the checkout opt-in produced, for the confirmation screen. Absent (null)
 *  means "nothing started" — invalid block, rate-limited, send failure, or leg
 *  error — and the client falls back to the inline form, which retries through
 *  the public endpoint. */
type VipJoinResult =
  | { status: "already_member" }
  | { status: "verify_sent"; email: string; pollId: string; ttlHours: number };

/**
 * Start the club signup for an order that just landed. NEVER throws and never
 * blocks the order — a marketing leg has no business failing a purchase. Runs
 * only on the success path (after the kitchen has the order), which is also what
 * guarantees the welcome pie can only apply to a FUTURE order: the code doesn't
 * exist until the customer taps the verification email.
 */
async function startVipEnrollment(join: ValidatedSignup | null): Promise<VipJoinResult | null> {
  if (!join) return null;
  try {
    // Same per-email send caps as the public form, shared buckets — checkout must
    // not become the email path the form's limits don't cover. The form's
    // IP/contact buckets are deliberately skipped: this leg only runs behind a
    // Turnstile-gated, catalog-priced, CARD-CAPTURED order, which throttles far
    // harder than any counter here would.
    const allowed = await rateLimitAll([
      { bucket: `signup:email:${join.email}:h`, max: 3, windowSec: 3600 },
      { bucket: `signup:email:${join.email}:d`, max: 5, windowSec: 86400 },
    ]);
    if (!allowed) return null;
    const parked = await parkPendingSignupAndSendLink("gigis_long_branch", join);
    if (parked.status === "send_failed") return null;
    return parked;
  } catch (err) {
    console.error("[order/create] vip enrollment leg failed (order unaffected)", err);
    return null;
  }
}

/** What every customer is told while the order ledger is unreachable. Ordering without the
 *  double-charge ledger is how the Aug-15 incident happened, so the answer is always "no". */
const LEDGER_DOWN_ANSWER = {
  error: "ordering_temporarily_unavailable",
  message: "Online ordering is temporarily unavailable. Please call the store at (732) 377-2468 to order.",
} as const;

/**
 * Page staff that the order database is unreachable and every web order is being refused.
 *
 * alertStaffOnce's cooldown lives in the same database, and claimWindow deliberately fails OPEN
 * for staff pages when that database is down — exactly when this page fires. Without a second
 * guard every refused checkout attempt would text staff. This per-instance memory caps it at one
 * page per warm instance per cooldown window (a cold instance may page once more: duplicate over
 * lost, as everywhere else). A page that failed to send is forgotten so the next attempt retries.
 */
let ledgerDownPagedAt = 0;
async function pageLedgerDown(): Promise<void> {
  const now = Date.now();
  if (ledgerDownPagedAt && now - ledgerDownPagedAt < STAFF_PAGE_COOLDOWN_SEC * 1000) return;
  ledgerDownPagedAt = now;
  const outcome = await alertStaffOnce(
    "order-database-unavailable",
    `ONLINE ORDERING IS DOWN — the order database is unreachable, every web order is being refused with "call the store". Check Neon (outage or monthly compute quota) and Vercel.`,
  );
  if (outcome === "failed") ledgerDownPagedAt = 0;
}

/**
 * Count checkouts refused BEFORE payment because the register could not take the order
 * (register_busy, order_routing_failed, pos_unavailable), and tell the owner when it keeps
 * happening. From Oct 6 to 10 Sea Bright refused every web checkout this way — about 7
 * customers and $374 of carts over 4.5 days — and nothing alerted: refused rows are deleted, so
 * the digest just said "No web orders yesterday". Only requests that got past Turnstile, the
 * rate limits, pricing and the reservation reach these refusals, so bots and validation errors
 * never count. Distinct checkouts, not taps: a key counts once per hour, so one customer
 * re-tapping cannot trip it. Email (alertOps), not a text — whether this should page the store
 * is the owner's call. Never throws, and a counter error just skips the count.
 */
async function noteSetupFailure(idempotencyKey: string, reason: string): Promise<void> {
  try {
    if (!(await claimWindow(`setup-fail:key:${idempotencyKey}`, 3600))) return;
    if (await rateLimit("setup-fail:all", 2, 3600)) return; // fewer than 3 distinct checkouts this hour
    await alertOpsOnce(
      "ordering-setup-failing",
      `CHECKOUT KEEPS FAILING BEFORE PAYMENT — 3 or more customers this hour could not place a web order (latest: ${reason}). No card was charged, but online ordering is effectively down. Check Clover (API token, outage, rate limits) and the Vercel logs for /api/order/create.`,
      3600,
    );
  } catch (err) {
    console.error("[order/create] setup-failure counter unavailable", err);
  }
}

/**
 * A burst of card declines is what card testing looks like (Turnstile raises the cost, it does
 * not remove it). More than 8 declines site-wide in a 15-minute window emails the owner once an
 * hour, so a pattern is noticed the same day instead of on the Clover statement; the count is also
 * shown by /api/admin/clover-status (api/lib/cardDeclines.ts). Never throws.
 */
async function noteDecline(): Promise<void> {
  try {
    if (await rateLimit(CARD_DECLINE_BUCKET, CARD_DECLINE_ALERT_ABOVE, CARD_DECLINE_WINDOW_SEC)) return;
    await alertOpsOnce(
      "card-declines",
      "CARD DECLINE SPIKE — more than 8 card declines on the website within 15 minutes. That pattern usually means someone is testing stolen cards. Check Clover's transactions; to stop online card payments, set VITE_CARD_PAYMENTS_OFF=1 in Vercel and redeploy.",
      3600,
    );
  } catch (err) {
    console.error("[order/create] decline counter unavailable", err);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  // ---- store hours gate (authoritative; the checkout UI mirrors it) ----
  // 5-minute grace so a checkout in flight at closing time isn't failed mid-payment.
  // A REPLAY is exempt (ported from Sea Bright): asking "what happened to the order I already
  // sent?" is not placing a new one, and the client tells an unresolved customer to tap again
  // — refused for being after 11 PM, the freeze protecting them cannot lift until morning.
  // The replay ladder below is read-only for every status it answers.
  const closedReplayKey =
    typeof (req.body ?? {})?.idempotencyKey === "string" ? String((req.body as Record<string, unknown>).idempotencyKey) : "";
  // The FIRST database read of every checkout, so it is where a Neon outage (or a suspended
  // Free-plan compute) shows up. Unguarded, it crashed the function: Vercel answered with a
  // plain-text error page the browser could not parse, and the "ONLINE ORDERING IS DOWN" page
  // further down was never reached. Fail closed with a readable answer and page staff.
  let closedReplay: Awaited<ReturnType<typeof peekOrder>> = null;
  if (/^[0-9a-f-]{36}$/i.test(closedReplayKey)) {
    try {
      closedReplay = await peekOrder(closedReplayKey);
    } catch (err) {
      console.error("[order/create] order database unavailable before payment", err);
      await pageLedgerDown();
      res.status(503).json(LEDGER_DOWN_ANSWER);
      return;
    }
  }
  // "retry" is the one kind that means "go ahead and place a NEW order" — that must not slip
  // past the closed gate. Every other kind is a read-only answer about money already in flight.
  const closedReplayAnswers = closedReplay != null && replayOrder(closedReplay).kind !== "retry";
  if (!isOrderingOpen(5) && !closedReplayAnswers) {
    res.status(409).json({
      error: "store_closed",
      message: closedTodayMessage() ?? "Online ordering is closed right now — we take web orders daily from 10 AM to 11 PM. The counter is open later Thursday through Sunday: call (732) 377-2468 and we'll take care of you.",
    });
    return;
  }

  // ---- card kill switch, server side (ported from Sea Bright) ----
  // The emergency stop OPERATIONS-2026-09-12.md documents. Before this, only the browser read
  // VITE_CARD_PAYMENTS_OFF, so a tab opened before the flip (or a direct POST) kept charging
  // cards through an incident like Aug 12-15. With prepay the only way to order, killing cards
  // closes online ordering outright — including $0.00 free-pie orders, which also create and
  // fire Clover orders (the same "closes everything" rule as Sea Bright, and the checkout
  // hides the free path while the switch is on). Honors BOTH variable names: the browser can
  // only read the VITE_ one, and an operator setting either must stop the server.
  // A REPLAY is exempt, same as the store-hours gate above: the switch gets flipped during
  // exactly the payment trouble that leaves customers frozen on "tap again to check", and the
  // replay ladder below is read-only for every status it answers.
  // Like every Vercel env change, flipping it takes effect on the next deployment (redeploy).
  const cardKilled = process.env.CARD_PAYMENTS_OFF === "1" || process.env.VITE_CARD_PAYMENTS_OFF === "1";
  if (cardKilled && !closedReplayAnswers) {
    res.status(503).json({
      error: "card_payments_disabled",
      message: "Online ordering is paused right now — please call (732) 377-2468 and we'll take your order.",
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
  const paymentMethod = "card" as const;
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
    // The client's own gate is looser (any 10+ digits), so this IS customer-reachable —
    // e.g. an international number — and without a message the checkout banner rendered
    // the raw error key.
    res.status(400).json({ error: "valid_phone_required", message: "Please enter a 10-digit US phone number — we text order updates to it." });
    return;
  }
  // Email is REQUIRED so every website order gets an emailed receipt.
  if (typeof customer.email !== "string" || customer.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim().toLowerCase())) {
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
  // Either family is accepted here: a campaign word (GAMEDAY) or a welcome PIE- code. This is
  // only a shape check — which family it actually belongs to is settled against the database
  // below, by the same resolver the checkout preview uses.
  const promoCode = promoCodeRaw ? (normalizeCampaignCode(promoCodeRaw) ?? normalizePromoCode(promoCodeRaw)) : null;
  if (promoCodeRaw && !promoCode) {
    res.status(400).json({ error: "promo_invalid", message: "That code doesn't look right — check it and try again." });
    return;
  }
  // Whether a code is pickup-only is settled below, once the resolver says which offer it is:
  // the welcome pie always is; a campaign code says so on its row (STORM25 allows delivery).
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
    await pageLedgerDown();
    res.status(503).json(LEDGER_DOWN_ANSWER);
    return;
  }
  // 'charged' means the card was taken but the order had not fired yet — it is
  // still a draft, so it is in no POS and no ticket printed. Reporting that as a
  // finished order hands the customer a confirmation for food nobody is making,
  // so it takes the routing-issue path and pages staff instead.
  // One alert per stuck key per half hour: these two replay branches run BEFORE the rate
  // limiter (so a charged customer never sees a 429), which also means a customer leaning on
  // retry — or a tab left polling — would otherwise page staff on every single POST.
  const replayAlertOk = () =>
    rateLimitAll([{ bucket: `alert:replay:${idempotencyKey}`, max: 1, windowSec: 1800 }]);
  if (prior && replayOrder(prior).kind === "routing_issue") {
    if (await replayAlertOk()) await alertStaffOnce(`order:${idempotencyKey}`, `PAID WEB ORDER NOT FIRED — retry seen for Clover order ${prior?.cloverOrderId ?? "?"} charge ${prior?.chargeId ?? "?"}; open it in the POS.`);
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
    res.status(200).json({ ok: true, orderId: prior.cloverOrderId, paid: replayOrder(prior).paid, duplicate: true });
    return;
  }
  if (prior && replayOrder(prior).kind === "uncertain") {
    // A free-pie order (routing_uncertain) never involved a card: its retry must not page an
    // uncertain CARD result or warn the customer about being charged twice.
    const noCharge = prior.status === "routing_uncertain";
    if (await replayAlertOk()) await alertStaffOnce(`order:${idempotencyKey}`, noCharge
      ? `FREE VIP PIE ORDER NOT CONFIRMED — retry seen for Clover order ${prior.cloverOrderId ?? "?"} (nothing owed). Make it if it is in the POS; then settle the code in Admin.`
      : `UNCERTAIN WEB ORDER — retry seen for Clover order ${prior.cloverOrderId ?? "?"}; verify payment and order state before remaking.`);
    res.status(409).json({ error: "uncertain", message: noCharge
      ? "We couldn't confirm whether your order reached the kitchen. Please call the store before ordering again."
      : "We couldn't confirm your previous attempt. Please call the store before re-ordering so you aren't charged twice." });
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

  // (There used to be an inline sweepQueuedPrints(3) here: Clover GETs for OTHER customers'
  // queued tickets, in front of this customer's own rate-limited line-item burst. The
  // sweep-prints cron now runs every 15 minutes through all ordering hours and settles those
  // rows itself, so the order path no longer spends its time or Clover quota on them.)

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
  // A campaign offer (GAMEDAY) is multi-use, so it is never reserved or burned like the
  // one-per-member welcome pie — each order simply appends a row to campaign_redemptions.
  let campaign: { id: number; code: string; freeCount: number } | null = null;
  let discount = 0;
  let kitchenLines: CartLineInput[] = lines;
  let appliedCode: string | null = null;
  if (promoCode) {
    const check = await resolvePromo("gigis_long_branch", promoCodeRaw);
    if (!check.ok) {
      res.status(400).json({ error: "promo_invalid", message: check.message });
      return;
    }
    if (fulfillment !== "pickup" && (check.kind === "welcome" || check.pickupOnly)) {
      res.status(400).json({
        error: "promo_pickup_only",
        message: "That code is good on pickup orders only — switch to pickup to use it.",
      });
      return;
    }
    appliedCode = check.code;
    if (check.kind === "bogo_pizza") {
      const applied = applyBogoPizza(lines, check.code);
      if (!applied) {
        res.status(400).json({
          error: "promo_needs_two_pizzas",
          message: "Buy one pizza, get one free — add a second pizza to your order to use this code.",
        });
        return;
      }
      campaign = { id: check.id, code: check.code, freeCount: applied.freeCount };
      discount = applied.discountCents;
      kitchenLines = applied.lines;
    } else if (check.kind === "pct_pizza") {
      // Percent off every pizza, toppings included (src/lib/pizzaPercent.ts, shared with the browser).
      const applied = applyPizzaPercent(lines, check.code, check.percentOff);
      if (!applied) {
        res.status(400).json({
          error: "promo_needs_pizza",
          message: `${check.percentOff}% off any pizza — add a pizza from the Pizza menu to use this code.`,
        });
        return;
      }
      campaign = { id: check.id, code: check.code, freeCount: 0 };
      discount = applied.discountCents;
      kitchenLines = applied.lines;
    } else {
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
  // A cart holding only the free pie totals exactly $0.00 once the discount and the after-discount
  // tax are applied. That used to be refused ("add anything else, or just come in") — which is
  // exactly what a member who wants nothing but their free pie was promised they would not have
  // to do. It now skips the card step entirely and goes to the kitchen; see the free branch below.
  const freeOrder = isFreePickupOrder(totals.total, promo !== null || campaign !== null, fulfillment);
  if (totals.total <= 0 && !freeOrder) {
    res.status(400).json({
      error: "empty_order",
      message: "Your total comes to $0.00 — please add an item to your order.",
    });
    return;
  }
  // Finalizes the reservation after the order lands with confirmed payment. The
  // atomic claim below already prevents a second order from receiving the same discount.
  const redeemPromo = async (orderRef: string) => {
    // Multi-use offers are counted, not consumed: recording never throws and never blocks
    // the next customer, so it is safe on every one of the paths that reach here.
    if (campaign) {
      await recordCampaignRedemption(campaign.id, idempotencyKey, {
        orderRef, phone: cust.phone, discountCents: discount, freeCount: campaign.freeCount,
      });
    }
    if (!promo) return;
    try {
      const first = await redeemPromoCode(promo.id, idempotencyKey);
      if (!first) {
        console.error(`[order/create] promo ${promo.code} already redeemed when order ${orderRef} completed`);
        await alertStaff(`FREE PIE CODE ${promo.code} landed on two orders at once — order ${orderRef} also got the free pie; flag for Tommy.`);
      }
    } catch (err) {
      // The sibling double-redeem branch pages staff; a THROWN redemption deserves the same —
      // the customer got the discounted pie, the code is still spendable, and only a human
      // burning it in the admin panel stops a second free pie.
      console.error("[order/create] promo redemption failed", err);
      await alertStaff(`FREE PIE CODE ${promo.code} could not be marked used after order ${orderRef} (DB error) — burn it manually so it can't be spent again.`);
    }
  };

  if (!cloverConfigured()) {
    res.status(503).json({ error: "ordering_not_configured", message: "Online ordering isn't switched on yet. Please call the store to order." });
    return;
  }

  // Reject request-shape failures before claiming either the order key or a one-time promo.
  // A $0.00 promo order carries no card at all — there is nothing for one to do.
  if (!freeOrder && (!cardToken || !cardToken.startsWith("clv_"))) {
    res.status(400).json({ error: "card_token_required" });
    return;
  }
  if (!freeOrder && totals.total < CARD_MIN_TOTAL) {
    res.status(400).json({ error: "order_too_small", message: "Card orders have a $1.00 minimum — please add an item." });
    return;
  }

  const cust = {
    name: customer.name.trim(),
    phone: customer.phone.trim(),
    email: customer.email?.trim().toLowerCase(),
    address: customer.address?.trim().slice(0, ADDR_MAX),
    town: isDeliveryTown(customer.town) ? customer.town : undefined,
  };

  // Optional VIP-club opt-in riding on the checkout. Parsed here (a pure check),
  // acted on only AFTER the order succeeds — see startVipEnrollment.
  const vipJoinReq = parseVipJoinWith(
    { normalizePhone, addressDedupeKey, legacyAddressDedupeKey, validateVipConsentAndLocality, canonicalConsentText: CANONICAL_CONSENT_TEXT },
    body.vip,
    cust,
    fulfillment,
  );

  // ---- idempotent reservation: atomically claim the key so a retry can't
  //      double-charge or double-fire. Replay/short-circuit if already seen. ----
  const signedInAccount = process.env.ACCOUNTS_ENABLED === "true" ? await readSession(req) : null;
  const reservation = await reserveOrder({
    accountId: signedInAccount?.id,
    idempotencyKey,
    fulfillment,
    customer: cust,
    items: kitchenLines,
    fee: totals.deliveryFee, discount: totals.discount, town: cust.town, promoCode: appliedCode ?? undefined,
    subtotal: totals.subtotal,
    cardPricing: totals.cardPricing,
    tax: totals.tax,
    tip: totals.tip,
    total: totals.total,
    paymentMethod: freeOrder ? "free" : paymentMethod,
  });
  let reservedId: number | null = null;
  if (reservation.reserved === true) {
    reservedId = reservation.id;
  } else if (reservation.reserved === false) {
    const ex = reservation.existing;
    const replay = replayOrder(ex);
    if (replay.kind === "routing_issue") {
      await alertStaffOnce(`order:${idempotencyKey}`, `PAID WEB ORDER NOT FIRED — retry seen for Clover order ${ex.cloverOrderId ?? "?"} charge ${ex.chargeId ?? "?"}; open it in the POS.`);
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
      res.status(200).json({ ok: true, orderId: ex.cloverOrderId, paid: replay.paid, duplicate: true, totals });
      return;
    }
    if (replay.kind === "processing") {
      res.status(409).json({ error: "processing", message: "This order is already being placed. Please wait a moment before retrying." });
      return;
    }
    // Stale 'pending': a prior attempt started but never durably recorded its
    // outcome (a mid-flight function kill can leave this even AFTER the Clover order
    // posted). Draft creation itself is not idempotent, so starting over could create
    // a second order or ticket. Do NOT re-create — flag staff to verify and ask the
    // customer to call, rather than risk making the food twice.
    await alertStaffOnce(`order:${idempotencyKey}`, `UNCERTAIN WEB ORDER — ${cust.name} ${maskPhone(cust.phone)} idem ${idempotencyKey.slice(0, 8)} — verify in POS before it is remade.`);
    res.status(409).json({ error: "uncertain", message: "We couldn't confirm your previous attempt went through. Please call the store to check before re-ordering." });
    return;
  }
  if (reservation.reserved === null) {
    // Failing closed is deliberate — ordering without the double-charge ledger is how the
    // Aug-15 incident happened. But every customer is being turned away, so a human must
    // hear about it: alertStaff reaches Resend/Twilio, which don't share Neon's fate.
    await pageLedgerDown();
    res.status(503).json(LEDGER_DOWN_ANSWER);
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

  // ---- who is ordering: VIP marker + address on file for the kitchen header ----
  // ONE round trip, read before the note is built and reused for the receipt's join
  // pitch below (it used to be a second, post-fire isVipMember lookup). A signed-in
  // rewards account counts as a VIP on its own.
  const vipCustomer = await lookupVipCustomer(
    "gigis_long_branch",
    `+1${phoneIdentity(cust.phone)}`,
    cust.email ?? null,
    signedInAccount?.id ?? null,
  );
  const noteHeader = {
    vipMember: vipCustomer.member,
    // Either promo family earns the marker: the per-member welcome pie and the
    // multi-use campaign code (GAMEDAY) are both "this ticket used a VIP offer".
    vipPromo: appliedCode !== null,
    addressOnFile: vipCustomer.address,
  };

  const releasePromo = async () => {
    if (!promo) return;
    try {
      await releasePromoCode(promo.id, idempotencyKey);
    } catch (err) {
      console.error("[order/create] promo release failed", err);
    }
  };

  // ---- card payment: one website order = one itemized Clover order ----
  // Build the draft, verify Clover's own amount, then pay THAT exact order. If
  // any pre-charge setup step fails, stop before money moves. Never fall back to
  // a standalone charge plus a second POS order: that legacy path produced two
  // Clover records for one customer order and made kitchen reconciliation unsafe.
  let chargeId: string | undefined;
  let paidOrderId: string | undefined;
  if (freeOrder) {
    // ---- $0.00 pickup: the promo covers the whole order, so no card and no /pay ----
    // The itemized order is still created in Clover exactly as a paid one is (zero-priced free
    // line, note, title), then joins the SAME fire → print → redeem → receipt tail below. The
    // kitchen, the audit row and the customer's receipt see no difference except the wording.
    try {
      const draft = await createDraftOrder({
        lines: kitchenLines,
        fulfillment,
        deliveryFee: 0,
        cardPricing: 0,
        note: buildOrderNote({ fulfillment, customer: cust, lines: kitchenLines, totals, payment: "free", orderNote, ...noteHeader }),
        retry: cloverRetryBudget(),
      });
      paidOrderId = draft.id;
      // Durable pointer BEFORE the fire, and with it `routing_uncertain` (ported from Sea Bright),
      // not the `pending` it would otherwise keep: a pending row holding a Clover id reads as an
      // uncertain CARD capture, so a retry before the fire was confirmed told a free-pie customer
      // "so you aren't charged twice" and paged staff about a card result that never existed.
      if (reservedId != null) await updateOrderStrict(reservedId, { cloverOrderId: draft.id, status: "routing_uncertain" });
    } catch (err) {
      // Nothing was charged and nothing was fired: hand the code and the key back so the
      // customer can simply try again, or show the code at the counter.
      console.error("[order/create] free order could not be created in Clover", err);
      if (reservedId != null) await releaseOrder(reservedId);
      await releasePromo();
      await noteSetupFailure(idempotencyKey, "pos_unavailable");
      res.status(502).json({
        error: "pos_unavailable",
        message: "We couldn't reach the register just now. Please try again in a moment — or show your code at the counter and we'll take care of you.",
      });
      return;
    }
  } else if (paymentMethod === "card") {
    const orderAmount = totals.total - totals.tip; // Clover computes items + tax; tip is paid on top.
    let draftId: string | undefined;
    // ONE 429 allowance (≤6s of waiting in all) for every pre-payment Clover call below, so a
    // throttled register costs the customer seconds, not a failed checkout. /pay never retries.
    const setupRetry = cloverRetryBudget();
    try {
      const draft = await createDraftOrder({
        lines: kitchenLines,
        fulfillment,
        deliveryFee: totals.deliveryFee,
        cardPricing: totals.cardPricing,
        note: buildOrderNote({ fulfillment, customer: cust, lines: kitchenLines, totals, payment: "card", orderNote, ...noteHeader }),
        retry: setupRetry,
      });
      draftId = draft.id;
      // Persist the draft pointer before /pay. A function killed during payment must leave staff
      // one exact Clover order to inspect, and the same idempotency key must never make another.
      if (reservedId != null) await updateOrderStrict(reservedId, { cloverOrderId: draftId });
      const cloverAmount = await getEcommOrderAmount(draftId, orderAmount, setupRetry);
      if (cloverAmount !== orderAmount) {
        throw new Error(`Clover amount ${cloverAmount} did not match expected ${orderAmount}`);
      }
    } catch (err) {
      console.error(
        "[order/create] single-order setup failed before payment",
        err instanceof CloverError ? err.status : "",
        err instanceof Error ? err.message : err,
      );
      const discarded = !draftId || await deleteDraftOrder(draftId).then(() => true, () => false);
      if (discarded && reservedId != null) await releaseOrder(reservedId, { draftDiscarded: !!draftId });
      await releasePromo();
      // Clover still throttling after the allowance: say so, rather than "couldn't prepare".
      const busy = err instanceof CloverError && err.status === 429;
      await noteSetupFailure(idempotencyKey, busy ? "register_busy" : "order_routing_failed");
      res.status(502).json(
        busy
          ? {
              error: "register_busy",
              message: "Our register is busy right now, so your card was not charged. Please try again in a minute, or call the store.",
            }
          : {
              error: "order_routing_failed",
              message: "We couldn't prepare your Clover order, so your card was not charged. Please try again or call the store.",
            },
      );
      return;
    }

    try {
      // No email passed: Clover would send its own bare payment receipt on top of our branded one.
      const charge = await payForOrder({
        orderId: draftId,
        // The card_token_required gate above guarantees this for every non-free order, and only
        // a non-free order reaches this branch.
        source: cardToken as string,
        idempotencyKey,
        clientIp: ip,
        tipAmount: totals.tip || undefined,
      });
      // /pay explicitly confirmed the capture. Persist it before any optional tender lookup.
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
        console.error("[order/create] confirmed payment tender lookup failed", lookupErr);
      }
    } catch (err) {
      const status = err instanceof CloverError ? err.status : 500;
      const definitelyDeclined = isDefinitelyDeclined(err);
      if (!definitelyDeclined) {
        console.error("[order/create] pay-for-order UNCERTAIN — preserving order", status, err instanceof Error ? err.message : err);
        if (reservedId != null) await updateOrder(reservedId, { status: chargeId ? "charged" : "capture_uncertain", ...(chargeId ? { chargeId } : {}), cloverOrderId: draftId });
        await alertStaffOnce(`order:${idempotencyKey}`,
          `UNCERTAIN CARD RESULT — ${cust.name} ${maskPhone(cust.phone)} $${(totals.total / 100).toFixed(2)} — ` +
          `Clover order ${draftId} may hold a payment but we never got a confirmation. ` +
          `Open it in the POS: if it is paid, make the order; if not, it can be voided.` +
          (promo ? ` Free-pie code ${promo.code} remains on hold; release it in Admin only if no payment landed.` : ""),
        );
        res.status(200).json({
          ok: true,
          orderId: draftId,
          paid: !!chargeId,
          routingIssue: true,
          message: chargeId ? "Your payment went through. Please call the store to confirm your order was received before ordering again." : "We couldn't confirm your payment. Please call the store before re-ordering so we don't charge you twice.",
        });
        return;
      }

      // A definite decline moved no money, so deleting this one draft and releasing the key is safe.
      const discarded = await deleteDraftOrder(draftId).then(() => true, () => false);
      if (discarded && reservedId != null) await releaseOrder(reservedId, { draftDiscarded: true });
      await releasePromo();
      console.error("[order/create] pay-for-order declined", status, err instanceof Error ? err.message : err);
      await noteDecline();
      res.status(402).json({ error: "payment_failed", message: "We couldn't process that card. Please try again or use a different card." });
      return;
    }
  }

  if (!paidOrderId || (!chargeId && !freeOrder)) {
    // Defensive invariant: every successful pay-for-order response sets both (a free order has no charge).
    // Preserve the reservation because reaching here after a payment call is ambiguous.
    console.error("[order/create] paid order invariant failed");
    if (reservedId != null) await updateOrder(reservedId, { status: "capture_uncertain", cloverOrderId: paidOrderId });
    await alertStaffOnce(`order:${idempotencyKey}`, `UNCERTAIN WEB ORDER — paid-order invariant failed for idempotency key ${idempotencyKey.slice(0, 8)}. Check Clover before retrying.`);
    res.status(200).json({
      ok: true,
      paid: false,
      routingIssue: true,
      message: "We couldn't confirm your payment. Please call the store before re-ordering so we don't charge you twice.",
    });
    return;
  }

  // Payment is attached to this exact itemized order. Fire that same order once, arm the print
  // follow-up, then give the kitchen printer a few seconds before answering the customer.
  const note = buildOrderNote({ fulfillment, customer: cust, lines: kitchenLines, totals, payment: freeOrder ? "free" : "card", chargeId, orderNote, ...noteHeader });
  // A free order owes nothing, so no page may call it "PAID".
  const moneyState = freeOrder ? "a FREE VIP order (nothing owed)" : "PAID";
  // Once true, the ticket is in the POS: the catch below must not report it as "not fired".
  let fired = false;
  // redeemPromo pages staff when it finds the code already redeemed, so it must run exactly
  // once per order, whichever path finishes it.
  let promoSettled = false;
  const settlePromo = async () => {
    if (promoSettled) return;
    promoSettled = true;
    await redeemPromo(paidOrderId);
  };
  try {
      // A club member outranks a promo: the member tag is the one staff act on.
      const ticketVip = vipCustomer.member ? "member" : appliedCode !== null ? "promo" : null;
      await fireOrder(paidOrderId, { paid: true, note, title: ticketTitle(fulfillment, freeOrder ? "free" : true, ticketVip) });
      fired = true;
      // Arm the print follow-up BEFORE waiting on the printer (Sea Bright does the same). The row
      // used to stay `charged` (or the free path's routing_uncertain) through the whole print
      // wait: a re-tap in that window paged "PAID WEB ORDER NOT FIRED — retry seen" for an order
      // already open in the POS, and a function killed there left a row the strand reminder later
      // called "never reached the kitchen". paid_print_queued replays as the placed order, and the
      // sweep-prints cron settles it: printed → paid; still not printed after 25 min → staff paged.
      const armed = reservedId != null && await updateOrder(reservedId, { status: "paid_print_queued", cloverOrderId: paidOrderId, note });
      // Burn the code NOW — the ticket is in the POS, so the pie is spent. Waiting behind the
      // print stage let a killed function leave a fired order whose code stayed on hold for good.
      await settlePromo();
      // Kitchen ticket: firing only makes the order visible in the POS — this is what drives the
      // printer. Awaited (not fire-and-forget) so it isn't killed by the serverless freeze after
      // the response; never throws. The SHORT checkout wait (~4s, see CHECKOUT_PRINT_POLL_DELAYS_MS)
      // catches an immediate FAILED, which is retried once; a ticket still moving through Clover's
      // queue — the normal case here, measured in minutes — is left to the sweep. The customer was
      // waiting ~23s on "Placing order…" for the old 24s poll, which almost always ended "queued".
      const ticket = await printOrderTicket(paidOrderId, { pollDelaysMs: CHECKOUT_PRINT_POLL_DELAYS_MS });
      if (ticket.queued) {
        // Still queued: already recorded by the arm above. If that write was lost, try once more;
        // if THAT fails nothing would ever follow up on this ticket, so page now (noisy but safe).
        const recorded = armed || (reservedId != null && await updateOrder(reservedId, { status: "paid_print_queued", cloverOrderId: paidOrderId, note }));
        if (!recorded) await alertStaffOnce(`print:${paidOrderId}`,
          `WEB ORDER PRINT UNCONFIRMED — Clover order ${paidOrderId} is ${moneyState}; confirm the kitchen received its ticket.`);
      } else if (!ticket.printed) {
        // A failed print job cannot be replayed later and the order is in the POS, so a silent
        // failure is exactly the "customer shows up, nobody made it" case — page staff. Page
        // FIRST and settle only on a confirmed send; a lost page leaves the row queued for the sweep.
        if (!armed && reservedId != null) await updateOrder(reservedId, { status: "paid_print_queued", cloverOrderId: paidOrderId, note });
        const paged = await alertStaffOnce(`print:${paidOrderId}`,
          `KITCHEN TICKET DID NOT PRINT — ${cust.name} ${maskPhone(cust.phone)} $${(totals.total / 100).toFixed(2)} — ` +
          `Clover order ${paidOrderId} is ${moneyState} and open in the POS, but no ticket came out (${ticket.error ?? ticket.state ?? "unknown"}). Print it from the POS.`,
        );
        if (paged === "sent" && reservedId != null) await settleQueuedPrint(reservedId, "paid_print_failed");
      } else if (reservedId != null) {
        // Paper confirmed: withdraw the queued handoff. Conditional, so only a still-queued row
        // moves; if this write is lost the sweep reads the same printed line items and settles it.
        if (armed) await settleQueuedPrint(reservedId, "paid");
        else await updateOrder(reservedId, { status: "paid", cloverOrderId: paidOrderId, note });
      }
      // Checkout opt-in first: a started (or absorbed) signup answers the
      // membership question itself, and suppresses the receipt's join pitch — a
      // "join the club" invite next to the verification email it just asked for
      // reads as a glitch. Deliberately NOT run on the paid-but-not-fired or
      // uncertain exits: no marketing on an order we cannot vouch for.
      const vipJoin = await startVipEnrollment(vipJoinReq);
      const vipEligible = vipJoin ? false : !vipCustomer.member;
      await sendOrderReceipt({ email: cust.email, name: cust.name, phone: cust.phone, fulfillment, address: cust.address, lines: kitchenLines, totals, paymentMethod: freeOrder ? "free" : paymentMethod, orderId: paidOrderId, vipPitch: vipEligible });
      res.status(200).json({
        ok: true,
        orderId: paidOrderId,
        paid: true,
        free: freeOrder || undefined,
        chargeId,
        totals,
        vipEligible,
        ...(vipJoin ? { vipJoin } : {}),
        ...(!ticket.printed && !ticket.queued
          ? { routingIssue: true, message: freeOrder
            ? "Your order is in, but please call the store to confirm the kitchen received it."
            : "Your payment went through, but please call the store to confirm the kitchen received your order." }
          : {}),
      });
    } catch (err) {
      if (fired) {
        // The ticket IS in the POS and something after the fire threw (nothing there is expected
        // to). The order stands: the row keeps the state it reached and the code is burned.
        console.error("[order/create] order fired, then a follow-up step failed", err);
        await settlePromo();
        await alertStaffOnce(`order:${idempotencyKey}`, `WEB ORDER — CHECK THE TICKET — ${cust.name} ${maskPhone(cust.phone)} — Clover order ${paidOrderId} is ${moneyState} and in the POS, but its kitchen ticket was not confirmed. Make it from the POS if no ticket printed.`);
        // Staff were just told the ticket was not confirmed, so the customer is told to call too,
        // in the same words the normal path uses for an unconfirmed ticket.
        res.status(200).json(freeOrder
          ? { ok: true, orderId: paidOrderId, paid: true, free: true, totals, vipEligible: false, routingIssue: true, message: "Your order is in, but please call the store to confirm the kitchen received it." }
          : { ok: true, orderId: paidOrderId, paid: true, chargeId, totals, vipEligible: false, routingIssue: true, message: "Your payment went through, but please call the store to confirm the kitchen received your order." });
        return;
      }
      if (freeOrder) {
        // A free order has no payment to protect, so none of the card recovery below is true of
        // it: no payment "went through", and paid_unrouted would start reminders about money
        // that was never taken. Clover may still have opened the order and lost the answer, so
        // the row stays routing_uncertain (every retry is told to call the store) and the code
        // stays ON HOLD until a person has looked: burning it costs a member a pie the kitchen
        // may never have made; releasing it could buy a second one.
        console.error("[order/create] free order did not fire", err);
        await alertStaffOnce(`order:${idempotencyKey}`,
          `FREE VIP PIE ORDER NOT CONFIRMED — ${cust.name.slice(0, 24)} ${maskPhone(cust.phone)} — Clover order ${paidOrderId} may not have reached the kitchen (nothing owed). ` +
          (promo ? `Make it if it is in the POS. If made: in Admin release code ${promo.code}'s hold AND mark it used. If not: release the hold only.` : "Make it if it is in the POS."));
        res.status(200).json({ ok: true, orderId: paidOrderId, paid: false, routingIssue: true, message: "We couldn't confirm your order reached the kitchen. Please call the store before ordering again." });
        return;
      }
      // Paid but not fired: the payment and items live on the SAME order, so
      // staff recovery is just opening that order in the POS. Never delete it.
      console.error("[order/create] fire failed after payment", err);
      await settlePromo();
      if (reservedId != null) await updateOrder(reservedId, { status: "paid_unrouted", note });
      await alertStaffOnce(`order:${idempotencyKey}`, `PAID WEB ORDER NOT FIRED — ${cust.name} ${maskPhone(cust.phone)} $${(totals.total / 100).toFixed(2)} — Clover order ${paidOrderId} holds the payment but didn't fire; open it in the POS.`);
      res.status(200).json({ ok: true, paid: true, chargeId, routingIssue: true, message: "Your payment went through, but please call the store to confirm your order was received." });
    }
  return;
}
