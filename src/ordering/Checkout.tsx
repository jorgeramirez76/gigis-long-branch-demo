import { useEffect, useMemo, useRef, useState } from "react";
import { lineUnitPrice, money, useCart, TAX_RATE } from "./CartContext";
import { LOCATION } from "../data/location";
import { blockReason as blockReasonFor, payDisabled, type GateState } from "./checkoutGate";
import { placementSuffix } from "../data/menuToppings";
import {
  applePayAvailable,
  cardPaymentEnabled,
  initApplePay,
  initCloverCard,
  type ApplePayHandle,
  type CloverCard,
} from "./cloverPayment";
import { Turnstile } from "../components/Turnstile";
import { turnstileEnabled } from "../lib/turnstile";
import { getOpenStatus, isDeliveryOpen, deliveryClosedReason, type OpenStatus } from "../lib/openStatus";
import { countUnits, readyMessage } from "../lib/readyTime";
import { DELIVERY_TOWNS, DELIVERY_FEES, deliveryFeeCents, formatFee, type DeliveryTown } from "../lib/deliveryZones";
import { VipJoinInline } from "./VipJoinInline";

type Fulfillment = "pickup" | "delivery";
type PaymentMethod = "pickup" | "card" | "cash";
const TIP_PCTS = [0, 10, 15, 20];
/** Keep in sync with FREE_PIE_ITEM in api/lib/promo.ts (that file pulls in the
 *  server DB client, so it can't be imported into the browser bundle). */
const FREE_PIE_ITEM = "Plain Pie";
const CARD_ENABLED = cardPaymentEnabled();
const TURNSTILE_ON = turnstileEnabled();
// Clover's Apple Pay session stops accepting a result at ~30s; leave headroom.
const APPLE_PAY_SHEET_MS = 20_000;
/** Ceiling on the order request itself. Generous — a healthy charge + POS print + receipt
 *  finishes far inside it. It exists only to rescue a connection that stalls with no response. */
const ORDER_TIMEOUT_MS = 45_000;

type Confirmation = { orderId?: string; paid: boolean; cash: boolean; total: number; discount?: number; fulfillment: Fulfillment; routingIssue?: boolean; units: number; vipEligible?: boolean; message?: string };

export function Checkout({ onClose }: { onClose: () => void }) {
  const cart = useCart();
  const [fulfillment, setFulfillment] = useState<Fulfillment>("pickup");
  const [payment, setPayment] = useState<PaymentMethod>(CARD_ENABLED ? "card" : "pickup");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [town, setTown] = useState<DeliveryTown | "">("");
  // Tip defaults follow the fulfillment — 20% on delivery, none on pickup — until the
  // customer taps a tip themselves; an explicit choice then survives switching.
  const [tipPct, setTipPct] = useState(0); // initial fulfillment is pickup
  const tipTouched = useRef(false);
  useEffect(() => {
    if (!tipTouched.current) setTipPct(fulfillment === "delivery" ? 20 : 0);
  }, [fulfillment]);
  const [orderNote, setOrderNote] = useState("");
  // VIP free-pie code. `promo` holds a server-validated code; whether it DISCOUNTS
  // right now still depends on pickup + a Plain Pie in the cart (promoDiscount below),
  // so switching to delivery just pauses it rather than wiping it.
  const [promoInput, setPromoInput] = useState("");
  const [promo, setPromo] = useState<{ code: string; discountCents: number } | null>(null);
  const [promoMsg, setPromoMsg] = useState("");
  const [promoChecking, setPromoChecking] = useState(false);
  const [openStatus, setOpenStatus] = useState<OpenStatus | null>(null);
  // Delivery closes at 10 PM while pickup runs to close, so this is tracked separately and
  // re-checked on the same minute tick — a customer sitting on the checkout at 9:59 sees it flip.
  const [deliveryOpen, setDeliveryOpen] = useState(true);
  useEffect(() => {
    const tick = () => {
      setOpenStatus(getOpenStatus());
      setDeliveryOpen(isDeliveryOpen());
    };
    tick();
    const t = setInterval(tick, 60_000); // flips the gate live at open/close
    return () => clearInterval(t);
  }, []);
  // If 10 PM passes while they are on this screen, move them to pickup rather than letting them
  // fill in an address the server will reject.
  useEffect(() => {
    if (!deliveryOpen && fulfillment === "delivery") setFulfillment("pickup");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryOpen]);
  const storeClosed = openStatus != null && !openStatus.open;
  const [status, setStatus] = useState<"form" | "submitting" | "error">("form");
  // Cash orders require an explicit acknowledgment that cash will be brought.
  // Re-checked every time the payment method changes.
  const [cashAgreed, setCashAgreed] = useState(false);
  useEffect(() => setCashAgreed(false), [payment]);
  const [errorMsg, setErrorMsg] = useState("");
  const [cardInitFailed, setCardInitFailed] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [turnstileFailed, setTurnstileFailed] = useState(false);
  const [confirmed, setConfirmed] = useState<Confirmation | null>(null);

  // One price whichever way you pay — mirrors computeTotals() on the server.
  // The fee is display-only here; the server recomputes it from the town it validates, so a
  // tampered client can never pay less than the schedule in lib/deliveryZones.ts.
  const deliveryFee = fulfillment === "delivery" ? (deliveryFeeCents("delivery", town) ?? 0) : 0;
  // The free pie discounts only a PICKUP order that actually contains a Plain Pie — mirrors the
  // server, which recomputes the discount from its own catalog and rejects anything else.
  const hasFreePie = cart.lines.some((l) => l.itemName === FREE_PIE_ITEM);
  const promoDiscount =
    promo && fulfillment === "pickup" && hasFreePie ? Math.min(promo.discountCents, cart.subtotal) : 0;
  // Tax follows the server: NJ taxes a separately stated delivery charge on taxable goods, so it
  // is taxed with the food (cart.tax alone would under-collect on delivery orders); a promo'd
  // free item is NOT taxable, so tax is computed after the discount.
  const tax = Math.round((cart.subtotal - promoDiscount + deliveryFee) * TAX_RATE);
  const tip = Math.round((cart.subtotal - promoDiscount) * (tipPct / 100));
  const grandTotal = cart.subtotal - promoDiscount + deliveryFee + tax + tip;
  // Apple Pay's button is built asynchronously and priced by message, so it needs
  // the live total rather than whatever it was on the render that started the load.
  const grandTotalRef = useRef(grandTotal);
  grandTotalRef.current = grandTotal;

  // One idempotency key per unique order (amount/params). Stable across pure
  // retries so a lost response can't double-charge; regenerated if the order
  // changes (Clover requires a fresh key when charge params differ).
  //
  // `grandTotal` is a dependency ON PURPOSE: it is the amount actually authorised, so ANY input
  // that moves the price regenerates the key automatically. Listing inputs by hand is what broke
  // this — the delivery fee added `town` as a new amount input and the array wasn't updated, so
  // changing town changed the charge while reusing a key Clover had already seen.
  const idempotencyKey = useMemo(
    () => {
      // The server requires a real UUID (UUID_RE in api/order/create.ts), so a timestamp-based
      // fallback would be rejected with idempotency_key_required on every attempt — the order
      // could never succeed. Build a v4 from getRandomValues, and only then fall back to Math.random.
      const c: Crypto | undefined = typeof crypto !== "undefined" ? crypto : undefined;
      if (c && typeof c.randomUUID === "function") return c.randomUUID();
      const b = new Uint8Array(16);
      if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
      else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
      b[6] = (b[6] & 0x0f) | 0x40; // version 4
      b[8] = (b[8] & 0x3f) | 0x80; // variant 10
      const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(cart.lines), tip, fulfillment, payment, town, grandTotal, promo?.code ?? ""],
  );
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  // Email is REQUIRED: every website order must get an emailed receipt.
  const contactOk = name.trim() && phone.replace(/\D/g, "").length >= 10 && emailOk;
  const deliveryOk = fulfillment === "pickup" || (address.trim().length > 4 && town !== "");

  // Clover hosted card fields — mount only when paying by card.
  const cardRef = useRef<CloverCard | null>(null);
  const numRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);
  const cvvRef = useRef<HTMLDivElement>(null);
  const postalRef = useRef<HTMLDivElement>(null);
  const [cardReady, setCardReady] = useState(false);

  useEffect(() => {
    if (payment !== "card" || !CARD_ENABLED) return;
    let cancelled = false;
    setCardReady(false);
    setCardInitFailed(false);
    initCloverCard()
      .then((card) => {
        if (cancelled) {
          card.destroy();
          return;
        }
        cardRef.current = card;
        if (numRef.current && dateRef.current && cvvRef.current && postalRef.current) {
          card.mount({
            number: numRef.current,
            date: dateRef.current,
            cvv: cvvRef.current,
            postal: postalRef.current,
          });
          setCardReady(true);
        } else {
          setCardInitFailed(true);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setCardInitFailed(true);
        setErrorMsg(e instanceof Error ? e.message : "Payment fields couldn't load.");
      });
    return () => {
      cancelled = true;
      cardRef.current?.destroy();
      cardRef.current = null;
    };
  }, [payment]);

  // ---- Apple Pay ----
  // Capability is probed in an effect, never at module scope or during render:
  // the homepage is prerendered by vite-react-ssg, where `window` doesn't exist.
  const [applePayOk, setApplePayOk] = useState(false);
  useEffect(() => setApplePayOk(applePayAvailable()), []);
  const applePayRef = useRef<ApplePayHandle | null>(null);
  const applePayMountRef = useRef<HTMLDivElement>(null);
  const applePayBusy = useRef(false);
  // The SDK registers its window listener once, so it would otherwise call a
  // handler frozen against the first render's cart and contact details.
  const payWithAppleRef = useRef<(token: string) => void>(() => {});

  useEffect(() => {
    if (!applePayOk || payment !== "card") return;
    let cancelled = false;
    initApplePay(() => grandTotalRef.current, {
      onToken: (t) => void payWithAppleRef.current(t),
      // Dismissing the sheet must not leave the form stuck on "Placing order…" —
      // but it must not wipe a decline message the shopper still needs to read.
      onCancel: () => {
        if (!applePayBusy.current) setStatus((s) => (s === "submitting" ? "form" : s));
      },
    })
      .then((handle) => {
        if (cancelled || !applePayMountRef.current) {
          handle.destroy();
          return;
        }
        applePayRef.current = handle;
        handle.mount(applePayMountRef.current);
      })
      // Domain not verified, SDK blocked, anything else — drop the button
      // entirely rather than leave a dead box above the card fields.
      .catch(() => {
        if (!cancelled) setApplePayOk(false);
      });
    return () => {
      cancelled = true;
      applePayRef.current?.destroy();
      applePayRef.current = null;
    };
    // grandTotal is deliberately not a dep — re-pricing the live sheet below
    // beats tearing the button down and rebuilding it on every tip tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applePayOk, payment]);

  useEffect(() => {
    applePayRef.current?.updateAmount(grandTotal);
  }, [grandTotal]);

  /** Validate a VIP code with the server BEFORE it can affect the total — never trust
   *  a typed code locally. Read-only on the server; redemption happens with the order. */
  async function applyPromo() {
    const raw = promoInput.trim();
    if (!raw || promoChecking) return;
    setPromoChecking(true);
    setPromoMsg("");
    try {
      const res = await fetch("/api/promo-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: raw }),
      });
      const data = await res.json();
      if (res.ok && data.valid && typeof data.code === "string") {
        setPromo({ code: data.code, discountCents: Number(data.discountCents) || 0 });
        setPromoInput("");
      } else {
        setPromo(null);
        setPromoMsg(data.message || "We couldn't check that code — please try again.");
      }
    } catch {
      setPromo(null);
      setPromoMsg("We couldn't check that code — please try again, or show it at the counter.");
    } finally {
      setPromoChecking(false);
    }
  }

  /** Shared by the typed card and Apple Pay — both hand over a `clv_…` token and
   *  take the identical server path. Throws so either caller reports the same way. */
  async function sendOrder(cardToken?: string, onDispatched?: () => void) {
    // A stalled connection — a phone losing signal mid-submit, which is exactly when people
    // order pizza — leaves fetch pending indefinitely with no error and no timeout of its own.
    // That is how "Placing order…" spins forever. Bound it well past any healthy request: the
    // function finishes or returns its own 504 long before this fires.
    const ctl = new AbortController();
    const stall = setTimeout(() => ctl.abort(), ORDER_TIMEOUT_MS);
    try {
      const res = await fetch("/api/order/create", {
        method: "POST",
        signal: ctl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fulfillment,
          paymentMethod: payment,
          cardToken,
          idempotencyKey,
          turnstileToken,
          customer: {
            name, phone, email,
            address: fulfillment === "delivery" ? address : undefined,
            town: fulfillment === "delivery" ? town : undefined,
          },
          tipCents: tip,
          orderNote,
          // Only the CODE is sent — the server re-validates it and derives the discount
          // from its own catalog. Omitted entirely when it isn't discounting right now.
          promoCode: promoDiscount > 0 && promo ? promo.code : undefined,
          // Send identifiers only — the server prices from its own catalog.
          lines: cart.lines.map((l) => ({
            itemName: l.itemName,
            categoryId: l.categoryId,
            options: l.options.map((o) => ({ group: o.group, name: o.name, placement: o.placement })),
            quantity: l.quantity,
            notes: l.notes,
          })),
        }),
      });
      // The server has answered, so it redeemed the Turnstile token — from here a retry needs
      // a fresh one. Before this point the token is untouched.
      onDispatched?.();
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Order failed");
      const orderedUnits = countUnits(cart.lines);
      setConfirmed({
        units: orderedUnits,
        orderId: data.orderId,
        paid: !!data.paid,
        cash: payment === "cash",
        // Prefer the server's authoritative total (what was actually charged /
        // sent to the POS); the client figure is only a fallback.
        total: typeof data.totals?.total === "number" ? data.totals.total : grandTotal,
        discount: typeof data.totals?.discount === "number" ? data.totals.discount : promoDiscount,
        fulfillment,
        routingIssue: data.routingIssue,
        vipEligible: data.vipEligible !== false,
        // The server hand-writes this when it CANNOT vouch for the payment. Carry it through
        // and show it verbatim rather than the screen's own cheerier wording.
        message: typeof data.message === "string" ? data.message : undefined,
      });
      // Keep the cart when the payment is unconfirmed. Clearing it forces a rebuild, and the
      // idempotency key is memoized on cart contents — a rebuilt cart mints a new key, so the
      // server's replay guard can't recognise the retry and the customer really is charged twice.
      if (!(data.routingIssue && !data.paid)) cart.clear();
    } catch (e) {
      // Retrying after a stall is SAFE and is the right advice: the idempotency key is memoized
      // on the cart contents, and the server replays a prior result ahead of both the charge and
      // the bot check. Never tell them it simply failed — the order may well have landed, and
      // "failed" is what makes someone order the same pizza twice.
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error(
          "That is taking longer than usual — the connection may have dropped. Tap Pay & place order again to check on it; you won't be charged twice.",
        );
      }
      throw e;
    } finally {
      clearTimeout(stall);
    }
  }

  /**
   * `tokenSpent` — whether this attempt actually reached the server. Cloudflare only burns a
   * Turnstile token when /api/order/create redeems it, so a failure on the way there (card
   * declined inside Clover's iframe, tokenize timeout, dropped connection) leaves the token
   * perfectly good. Resetting it regardless was a dead end: the reset widget needs a fresh
   * interaction, the Pay button's disabled includes !turnstileToken, and nothing on screen
   * said so — one bad CVV and "Pay & place order" never worked again.
   */
  function failOrder(e: unknown, tokenSpent: boolean) {
    setStatus("error");
    setErrorMsg(e instanceof Error ? e.message : "Something went wrong. Please call to order.");
    if (TURNSTILE_ON && tokenSpent) {
      setTurnstileToken(null);
      setTurnstileReset((n) => n + 1);
    }
  }

  async function placeOrder() {
    // Fresh check at click time (the interval only ticks each minute); the
    // server enforces the same gate authoritatively.
    if (!getOpenStatus().open) {
      setOpenStatus(getOpenStatus());
      setStatus("error");
      setErrorMsg("We're closed right now — online ordering reopens at 10 AM.");
      return;
    }
    setStatus("submitting");
    setErrorMsg("");
    let spent = false;
    try {
      let cardToken: string | undefined;
      if (payment === "card") {
        if (!cardRef.current) throw new Error("Payment fields aren't ready yet — one moment.");
        cardToken = await cardRef.current.tokenize();
      }
      await sendOrder(cardToken, () => {
        spent = true;
      });
    } catch (e) {
      failOrder(e, spent);
    }
  }

  /** Apple Pay authorized: charge it exactly like a typed card, then release the sheet. */
  async function payWithApple(token: string) {
    if (applePayBusy.current) return; // the sheet can fire more than once
    applePayBusy.current = true;
    // Clover stops honouring the sheet's success/failure signal about 30s after the
    // token. The card is charged early in the server call, but the kitchen print and
    // receipt email are awaited after it — so on a slow tail, release the sheet
    // before that deadline rather than let a captured payment read as "Payment Not
    // Completed" on the customer's phone and get re-ordered. `finish` only closes
    // the sheet; it moves no money in either direction.
    let settled = false;
    let spent = false;
    const release = (ok: boolean) => {
      if (settled) return;
      settled = true;
      applePayRef.current?.finish(ok);
    };
    const deadline = setTimeout(() => release(true), APPLE_PAY_SHEET_MS);
    try {
      if (!getOpenStatus().open) {
        setOpenStatus(getOpenStatus());
        throw new Error("We're closed right now — online ordering reopens at 10 AM.");
      }
      // Never charge a total the shopper didn't see. Face ID approved whatever the
      // sheet last displayed; if the cart has moved since, make them approve again.
      const approved = applePayRef.current?.requestedAmount();
      if (approved !== grandTotal) {
        throw new Error("Your total changed just now — please tap Apple Pay again to confirm it.");
      }
      setStatus("submitting");
      setErrorMsg("");
      await sendOrder(token, () => {
        spent = true;
      });
      release(true);
    } catch (e) {
      release(false);
      failOrder(e, spent);
    } finally {
      clearTimeout(deadline);
      applePayBusy.current = false;
    }
  }
  payWithAppleRef.current = payWithApple;

  // ---- Confirmation screen ----
  if (confirmed) {
    return (
      <Shell onClose={onClose} title="Order received">
        <div className="flex-1 space-y-4 overflow-y-auto p-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-brand-red)]/10">
            <svg viewBox="0 0 24 24" className="h-8 w-8 text-[var(--color-brand-red)]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <div>
            <h3 className="font-display text-3xl text-[var(--color-ink)]">Thanks, {name.split(" ")[0] || "friend"}!</h3>
            <p className="mt-2 text-[var(--color-ink-soft)]">
              Your {confirmed.fulfillment} order is in{confirmed.paid ? " and paid" : ""}. We're firing it up now.
            </p>
            {confirmed.cash && (
              <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">
                💵 Please have {money(confirmed.total)} in cash ready{" "}
                {confirmed.fulfillment === "delivery" ? "for your delivery driver" : "at pickup"}.
              </p>
            )}
          </div>
          {/* A routing issue means nothing reached the kitchen, so there is no ready time to
              promise. Showing one sends the customer in for food nobody started. */}
          {!confirmed.routingIssue && (
            <div className="rounded-2xl border-2 border-[var(--color-brand-red)]/25 bg-[var(--color-brand-red)]/8 px-4 py-3.5">
              <p className="text-base font-bold text-[var(--color-ink)]">
                ⏱ {readyMessage(confirmed.units, confirmed.fulfillment)}
              </p>
            </div>
          )}
          <div className="rounded-2xl bg-white p-4 text-sm shadow-[var(--shadow-sm)]">
            {confirmed.discount ? (
              <div className="mb-1 flex justify-between"><span className="text-[var(--color-ink-soft)]">VIP free pie</span><span className="font-semibold">−{money(confirmed.discount)}</span></div>
            ) : null}
            <div className="flex justify-between"><span className="text-[var(--color-ink-soft)]">Total</span><span className="font-bold">{money(confirmed.total)}</span></div>
            {confirmed.orderId && <div className="mt-1 flex justify-between"><span className="text-[var(--color-ink-soft)]">Order #</span><span className="font-mono text-xs">{confirmed.orderId.slice(-8).toUpperCase()}</span></div>}
          </div>
          {confirmed.routingIssue && (
            <p className="rounded-xl bg-[var(--color-brand-red)]/8 px-4 py-3 text-sm text-[var(--color-ink)]">
              {/* Never assert the payment landed on our own authority: the uncertain-payment
                  branch returns paid:false precisely because Clover may or may not hold the
                  capture. Say what the server said, and only fall back when it said nothing. */}
              {confirmed.message ?? "Your payment went through."} Please call{" "}
              <a className="font-semibold text-[var(--color-brand-red)]" href={`tel:${LOCATION.phoneTel}`}>{LOCATION.phone}</a>{" "}
              to confirm we received it.
            </p>
          )}
          {confirmed.vipEligible && (
            /* Inline signup, prefilled from the order the customer just placed — replaces the old
               #vip-club link that navigated away (and, until 7/30, didn't even scroll). */
            <VipJoinInline
              name={name}
              phone={phone}
              email={email}
              address={confirmed.fulfillment === "delivery" ? address : ""}
            />
          )}
          <p className="text-xs text-[var(--color-ink)]/50">
            Questions? Call the shop at{" "}
            <a className="font-semibold text-[var(--color-brand-red)]" href={`tel:${LOCATION.phoneTel}`}>{LOCATION.phone}</a>.
          </p>
        </div>
        <div className="border-t border-[var(--color-ink)]/10 bg-white p-5">
          <button type="button" onClick={onClose} className="w-full rounded-full bg-[var(--color-brand-red)] px-6 py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-[var(--shadow-red)] transition hover:bg-[var(--color-brand-red-bright)]">
            Done
          </button>
        </div>
      </Shell>
    );
  }

  const submitting = status === "submitting";
  // One source of truth for "can they pay, and if not, why" — see checkoutGate.ts, whose
  // invariant (never disabled without telling them) is proven across the entire state
  // space by scripts/verify-checkout-gate.mjs.
  const gate: GateState = {
    storeClosed,
    submitting,
    cartEmpty: cart.lines.length === 0,
    contactOk: !!contactOk,
    deliveryOk: !!deliveryOk,
    payment,
    cardReady,
    cardInitFailed,
    cashAgreed,
    turnstileOn: TURNSTILE_ON,
    turnstileToken: !!turnstileToken,
    turnstileFailed,
    phone: LOCATION.phone,
  };
  const payIsDisabled = payDisabled(gate);
  const blockReason = blockReasonFor(gate);
  // Apple Pay skips the card fields but still needs everything else the main
  // submit button requires — the sheet charges immediately, with no second chance
  // to catch a missing phone number or delivery address.
  const applePayBlocked =
    storeClosed ||
    !contactOk ||
    !deliveryOk ||
    submitting ||
    cart.lines.length === 0 ||
    (TURNSTILE_ON && !turnstileToken);

  return (
    <Shell onClose={onClose} title="Checkout">
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        {storeClosed && (
          <div className="rounded-2xl border border-[var(--color-brand-red)]/25 bg-[var(--color-brand-red)]/8 px-4 py-3 text-sm text-[var(--color-ink)]">
            <span className="font-bold">We're closed right now.</span> Online ordering is open daily from 10 AM until
            close (11 PM Mon–Wed, midnight Thu–Sun). Your cart will be saved — see you when we open!
          </div>
        )}

        {/* Fulfillment */}
        <Segmented
          options={["pickup", "delivery"] as Fulfillment[]}
          value={fulfillment}
          onChange={setFulfillment}
          disabledOption={deliveryOpen ? undefined : "delivery"}
        />
        {!deliveryOpen && !storeClosed && (
          <p className="-mt-1 rounded-xl bg-[var(--color-brand-red)]/8 px-4 py-2.5 text-sm text-[var(--color-ink)]">
            {deliveryClosedReason()}
          </p>
        )}

        {/* Contact */}
        <div className="space-y-3">
          <Field label="Name" value={name} onChange={setName} placeholder="Your name" required />
          <Field label="Mobile phone" value={phone} onChange={setPhone} placeholder="(732) 555-0100" type="tel" required />
          <Field label="Email (for your receipt)" value={email} onChange={setEmail} placeholder="you@email.com" type="email" required />
          {fulfillment === "delivery" && (
            <>
              <Field label="Delivery address" value={address} onChange={setAddress} placeholder="Street and apt" required />
              <label className="block">
                <span className="text-sm font-semibold text-[var(--color-ink-soft)]">
                  Town<span className="text-[var(--color-brand-red)]"> *</span>
                </span>
                <select
                  value={town}
                  onChange={(e) => setTown(e.target.value as DeliveryTown | "")}
                  required
                  aria-required
                  className="mt-1 w-full rounded-xl border border-[var(--color-ink)]/15 bg-white px-4 py-3 text-base text-[var(--color-ink)] focus:border-[var(--color-brand-red)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-red)]/20"
                >
                  <option value="">Choose your town…</option>
                  {DELIVERY_TOWNS.map((t) => (
                    <option key={t} value={t}>
                      {t} — {formatFee(DELIVERY_FEES[t])} delivery
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-[var(--color-ink)]/55">
                  Don't see your town? Give us a call — we may still be able to help.
                </span>
              </label>
            </>
          )}
        </div>

        {/* Tip */}
        <div>
          <p className="mb-2 text-sm font-bold text-[var(--color-ink)]">Add a tip</p>
          <div className="grid grid-cols-4 gap-2">
            {TIP_PCTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  tipTouched.current = true; // an explicit choice survives fulfillment switches
                  setTipPct(p);
                }}
                className={`rounded-xl border py-2.5 text-sm font-semibold transition ${
                  tipPct === p ? "border-[var(--color-brand-red)] bg-[var(--color-brand-red)] text-white" : "border-[var(--color-ink)]/15 bg-white text-[var(--color-ink)]"
                }`}
              >
                {p === 0 ? "None" : `${p}%`}
              </button>
            ))}
          </div>
        </div>

        {/* Payment method */}
        <div>
          <p className="mb-2 text-sm font-bold text-[var(--color-ink)]">Payment</p>
          {CARD_ENABLED ? (
            <>
              <div className="grid grid-cols-3 gap-1 rounded-full bg-white p-1 shadow-[var(--shadow-sm)]">
                {(["card", "pickup", "cash"] as PaymentMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPayment(m)}
                    className={`rounded-full px-1 py-2.5 text-[13px] font-bold transition ${
                      payment === m ? "bg-[var(--color-brand-red)] text-white" : "text-[var(--color-ink)]"
                    }`}
                  >
                    {m === "card" ? "Pay online" : m === "cash" ? "Cash" : `Card at ${fulfillment}`}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-[var(--color-ink)]/55">
                {payment === "cash"
                  ? `Have the total ready ${fulfillment === "delivery" ? "for the driver" : "at pickup"}.`
                  : "Pay securely online, or choose Cash and pay when you get your order."}
              </p>
              {payment === "card" && (
                <div className="mt-3 space-y-2.5 rounded-2xl bg-white p-4 shadow-[var(--shadow-sm)]">
                  {applePayOk && (
                    <div className="space-y-2">
                      {/* The button is a Clover-hosted iframe, so it can't be
                          disabled — block taps until the order is actually placeable. */}
                      <div className={applePayBlocked ? "pointer-events-none opacity-40" : ""}>
                        <div ref={applePayMountRef} className="h-[46px] w-full overflow-hidden rounded-xl" />
                      </div>
                      <p className="text-center text-[11px] text-[var(--color-ink)]/60">
                        {applePayBlocked
                          ? "Fill in your details above to use Apple Pay."
                          : "One tap — no card typing."}
                      </p>
                      <div className="flex items-center gap-3 pt-1">
                        <span className="h-px flex-1 bg-[var(--color-ink)]/10" />
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-ink)]/60">
                          or pay by card
                        </span>
                        <span className="h-px flex-1 bg-[var(--color-ink)]/10" />
                      </div>
                    </div>
                  )}
                  <CardField label="Card number" innerRef={numRef} />
                  <div className="grid grid-cols-2 gap-2.5">
                    <CardField label="Expiry" innerRef={dateRef} />
                    <CardField label="CVV" innerRef={cvvRef} />
                  </div>
                  <CardField label="ZIP" innerRef={postalRef} />
                  {!cardReady && !cardInitFailed && <p className="text-xs text-[var(--color-ink)]/60">Loading secure card fields…</p>}
                  {cardInitFailed && (
                    <div className="rounded-xl bg-[var(--color-brand-red)]/8 px-3 py-2.5 text-xs text-[var(--color-ink)]">
                      Card payment isn't available right now.{" "}
                      <button type="button" onClick={() => setPayment("pickup")} className="font-bold text-[var(--color-brand-red)] underline">
                        Pay at {fulfillment} instead
                      </button>
                    </div>
                  )}
                  <p className="flex items-center gap-1.5 text-[11px] text-[var(--color-ink)]/60">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                    Encrypted & processed securely. We never see your card number.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-2xl bg-white p-4 text-sm text-[var(--color-ink-soft)] shadow-[var(--shadow-sm)]">
              <div className="mb-2 grid grid-cols-2 gap-1 rounded-full bg-[var(--color-cream)] p-1">
                {(["pickup", "cash"] as PaymentMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPayment(m)}
                    className={`rounded-full px-1 py-2.5 text-[13px] font-bold transition ${
                      payment === m ? "bg-[var(--color-brand-red)] text-white" : "text-[var(--color-ink)]"
                    }`}
                  >
                    {m === "cash" ? "Cash" : `Card at ${fulfillment}`}
                  </button>
                ))}
              </div>
              Pay when you {fulfillment === "delivery" ? "receive your delivery" : "pick up"}. We'll have it ready.
            </div>
          )}
        </div>

        {/* Order note */}
        <div>
          <label htmlFor="order-note" className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--color-ink)]/55">
            Anything else? (optional)
          </label>
          <input
            id="order-note"
            value={orderNote}
            onChange={(e) => setOrderNote(e.target.value)}
            placeholder="Allergies, utensils, pickup notes…"
            className="w-full rounded-xl border border-[var(--color-cream-darker)] bg-white px-4 py-3 text-sm focus:border-[var(--color-brand-red)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-red)]/15"
          />
        </div>

        {/* VIP free-pie code */}
        <div>
          <p className="mb-2 text-sm font-bold text-[var(--color-ink)]">VIP free-pie code</p>
          {fulfillment === "delivery" ? (
            <p className="rounded-xl bg-[var(--color-cream)] px-4 py-3 text-sm text-[var(--color-ink-soft)]">
              Free-pie codes are good on <strong>pickup orders only</strong> — switch to pickup to redeem yours.
            </p>
          ) : promo ? (
            <div className="rounded-xl border border-[var(--color-gold,#c89441)]/50 bg-[var(--color-cream)] px-4 py-3 text-sm text-[var(--color-ink)]">
              <div className="flex items-center justify-between gap-3">
                <span>
                  ✓ <strong className="font-mono">{promo.code}</strong> — free {FREE_PIE_ITEM}
                  {hasFreePie && promoDiscount > 0 && <strong> (−{money(promoDiscount)})</strong>}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPromo(null);
                    setPromoMsg("");
                  }}
                  className="shrink-0 text-xs font-bold text-[var(--color-brand-red)] underline"
                >
                  Remove
                </button>
              </div>
              {!hasFreePie && (
                <p className="mt-1.5 text-xs text-[var(--color-brand-red)]">
                  Add a {FREE_PIE_ITEM} to your cart and it comes off the total here.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  value={promoInput}
                  onChange={(e) => setPromoInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void applyPromo();
                    }
                  }}
                  placeholder="PIE-XXXXXX"
                  aria-label="VIP free-pie code"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full rounded-xl border border-[var(--color-cream-darker)] bg-white px-4 py-3 font-mono text-sm uppercase focus:border-[var(--color-brand-red)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-red)]/15"
                />
                <button
                  type="button"
                  onClick={() => void applyPromo()}
                  disabled={promoChecking || !promoInput.trim()}
                  className="shrink-0 rounded-xl border border-[var(--color-brand-red)] px-4 py-3 text-sm font-bold text-[var(--color-brand-red)] transition hover:bg-[var(--color-brand-red)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {promoChecking ? "Checking…" : "Apply"}
                </button>
              </div>
              {promoMsg && (
                <p role="alert" className="mt-1.5 text-xs text-[var(--color-brand-red)]">
                  {promoMsg}
                </p>
              )}
              <p className="mt-1.5 text-xs text-[var(--color-ink)]/55">
                Got a VIP welcome code? Redeem your free {FREE_PIE_ITEM} here — pickup orders only.
              </p>
            </>
          )}
        </div>

        {/* Review */}
        <div className="rounded-2xl bg-white p-4 shadow-[var(--shadow-sm)]">
          <p className="mb-2 text-sm font-bold text-[var(--color-ink)]">Your order</p>
          <ul className="space-y-1.5 text-sm">
            {cart.lines.map((l) => (
              <li key={l.lineId} className="flex justify-between gap-3 text-[var(--color-ink-soft)]">
                <span className="min-w-0">
                  {l.quantity}× {l.itemName}
                  {l.options.length > 0 && <span className="text-[var(--color-ink)]/60"> — {l.options.map((o) => o.name + placementSuffix(o.placement)).join(", ")}</span>}
                </span>
                <span className="shrink-0">{money(lineUnitPrice(l) * l.quantity)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 border-t border-[var(--color-ink)]/8 pt-3 text-sm">
            <Row label="Subtotal" value={money(cart.subtotal)} />
            {promoDiscount > 0 && promo && <Row label={`VIP free pie (${promo.code})`} value={`−${money(promoDiscount)}`} />}
            {fulfillment === "delivery" &&
              (town === "" ? (
                <Row label="Delivery" value="choose your town" />
              ) : (
                <Row label={`Delivery to ${town}`} value={money(deliveryFee)} />
              ))}
            <Row label="NJ tax (6.625%)" value={money(tax)} />
            {tip > 0 && <Row label={`Tip (${tipPct}%)`} value={money(tip)} />}
            <div className="flex justify-between pt-1 text-base font-bold text-[var(--color-ink)]">
              <dt>Total</dt><dd>{money(grandTotal)}</dd>
            </div>
          </dl>
        </div>

        {status === "error" && (
          <p role="alert" className="rounded-xl bg-[var(--color-brand-red)]/8 px-4 py-3 text-sm text-[var(--color-ink)]">
            {errorMsg} You can also call <a className="font-semibold text-[var(--color-brand-red)]" href={`tel:${LOCATION.phoneTel}`}>{LOCATION.phone}</a>.
          </p>
        )}
      </div>

      <div className="border-t border-[var(--color-ink)]/10 bg-white p-5">
        {payment === "cash" && (
          <label className="mb-3 flex items-start gap-2.5 rounded-xl bg-[var(--color-cream)] px-3.5 py-3 text-sm text-[var(--color-ink)]">
            <input
              type="checkbox"
              checked={cashAgreed}
              onChange={(e) => setCashAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand-red)]"
            />
            <span>
              I'm paying <strong>{money(grandTotal)} in cash</strong>{" "}
              {fulfillment === "delivery" ? "when my order is delivered" : "when I pick up my order"}.
            </span>
          </label>
        )}
        {TURNSTILE_ON && (
          <Turnstile onToken={setTurnstileToken} resetSignal={turnstileReset} onLoadFailed={setTurnstileFailed} />
        )}
        {TURNSTILE_ON && turnstileFailed && (
          // The widget renders a bare 65px gap when it fails, so without this the customer
          // is staring at blank space. Retrying costs nothing and fixes transient cases.
          <button
            type="button"
            onClick={() => {
              setTurnstileFailed(false);
              setTurnstileReset((n) => n + 1);
            }}
            className="mb-2 w-full rounded-full border border-[var(--color-ink)]/15 px-4 py-2 text-xs font-bold uppercase tracking-wide text-[var(--color-ink)]/70"
          >
            Retry security check
          </button>
        )}
        <button
          type="button"
          onClick={placeOrder}
          disabled={payIsDisabled}
          className="flex w-full items-center justify-between rounded-full bg-[var(--color-brand-red)] px-6 py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-[var(--shadow-red)] transition hover:bg-[var(--color-brand-red-bright)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>{storeClosed ? "Closed — ordering opens 10 AM" : submitting ? "Placing order…" : payment === "card" ? "Pay & place order" : "Place order"}</span>
          <span>{money(grandTotal)}</span>
        </button>
        {blockReason && (
          <p className="mt-2 text-center text-xs font-semibold text-[var(--color-brand-red)]">{blockReason}</p>
        )}
        {submitting && (
          <p className="mt-2 text-center text-xs font-semibold text-[var(--color-brand-red)]">
            Hang tight — sending your order. Please don&apos;t close this window.
          </p>
        )}
        <p className="mt-2 text-center text-[11px] text-[var(--color-ink)]/60">
          {payment === "card"
            ? "Your card is charged securely. Order goes straight to Gigi's kitchen."
            : payment === "cash"
              ? `Order goes straight to Gigi's kitchen. Have ${money(grandTotal)} cash ready.`
              : "Order goes straight to Gigi's kitchen. Pay when you get it."}
        </p>
      </div>
    </Shell>
  );
}

function Shell({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  // aria-modal only tells a screen reader this is modal; it doesn't make it one.
  // Move focus in, keep Tab inside, close on Escape, and stop the page behind
  // from scrolling — otherwise the dialog is a trap for sighted mouse users only.
  useEffect(() => {
    const panel = panelRef.current;
    const restoreTo = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel?.querySelector<HTMLElement>("input,button,select,textarea,[tabindex]:not([tabindex='-1'])")?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex='-1'])"),
      ).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      restoreTo?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      // Close on a genuine backdrop click only. Using onClick meant a drag that
      // STARTED inside the form and ended on the backdrop — ordinary text
      // selection — counted as a click out here and wiped everything typed.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="flex max-h-[94vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-[var(--color-cream)] shadow-[var(--shadow-lg)] sm:rounded-3xl"
      >
        <header className="flex items-center justify-between border-b border-[var(--color-ink)]/10 bg-white px-5 py-4">
          <h2 className="font-display text-2xl text-[var(--color-ink)]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-[var(--color-ink)]/50 hover:bg-[var(--color-cream)]">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
  disabledOption,
}: {
  options: Fulfillment[];
  value: Fulfillment;
  onChange: (v: Fulfillment) => void;
  /** Rendered greyed out and unclickable — used to close delivery after 10 PM. */
  disabledOption?: Fulfillment;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-full bg-white p-1 shadow-[var(--shadow-sm)]">
      {options.map((f) => {
        const off = f === disabledOption;
        return (
          <button
            key={f}
            type="button"
            onClick={() => !off && onChange(f)}
            disabled={off}
            aria-disabled={off || undefined}
            title={off ? "Delivery stops at 10 PM" : undefined}
            className={`rounded-full py-2.5 text-sm font-bold capitalize transition ${
              off
                ? "cursor-not-allowed text-[var(--color-ink)]/35"
                : value === f
                  ? "bg-[var(--color-brand-red)] text-white"
                  : "text-[var(--color-ink)]"
            }`}
          >
            {f}
            {off && <span className="ml-1 font-normal normal-case opacity-80">(til 10 PM)</span>}
          </button>
        );
      })}
    </div>
  );
}

function CardField({ label, innerRef }: { label: string; innerRef: React.RefObject<HTMLDivElement> }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--color-ink)]/55">{label}</label>
      {/* Clover mounts a ~150px iframe in here. With min-h and vertical padding the box grew to
          ~176px, so the card section rendered about three times its intended height. Fix the box
          and clip it — never style the height from inside via the SDK's own style object: doing
          that on the Sea Bright site stopped clover.createToken() responding at all. */}
      <div
        ref={innerRef}
        className="h-[46px] overflow-hidden rounded-xl border border-[var(--color-cream-darker)] bg-white px-3"
      />
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, type = "text", required,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean }) {
  const id = "checkout-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--color-ink)]/55">
        {label}{required && <span className="text-[var(--color-brand-red)]"> *</span>}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        aria-required={required || undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-[var(--color-cream-darker)] bg-white px-4 py-3 text-sm focus:border-[var(--color-brand-red)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-red)]/15"
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[var(--color-ink-soft)]">
      <dt>{label}</dt><dd>{value}</dd>
    </div>
  );
}
