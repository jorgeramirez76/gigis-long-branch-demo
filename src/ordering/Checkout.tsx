import { useEffect, useMemo, useRef, useState } from "react";
import { lineUnitPrice, money, useCart } from "./CartContext";
import { LOCATION } from "../data/location";
import { cardPaymentEnabled, initCloverCard, type CloverCard } from "./cloverPayment";
import { Turnstile } from "../components/Turnstile";
import { turnstileEnabled } from "../lib/turnstile";

type Fulfillment = "pickup" | "delivery";
type PaymentMethod = "pickup" | "card";
const TIP_PCTS = [0, 10, 15, 20];
const CARD_ENABLED = cardPaymentEnabled();
const TURNSTILE_ON = turnstileEnabled();

type Confirmation = { orderId?: string; paid: boolean; total: number; fulfillment: Fulfillment; routingIssue?: boolean };

export function Checkout({ onClose }: { onClose: () => void }) {
  const cart = useCart();
  const [fulfillment, setFulfillment] = useState<Fulfillment>("pickup");
  const [payment, setPayment] = useState<PaymentMethod>(CARD_ENABLED ? "card" : "pickup");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [tipPct, setTipPct] = useState(15);
  const [orderNote, setOrderNote] = useState("");
  const [status, setStatus] = useState<"form" | "submitting" | "error">("form");
  const [errorMsg, setErrorMsg] = useState("");
  const [cardInitFailed, setCardInitFailed] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [confirmed, setConfirmed] = useState<Confirmation | null>(null);

  const tip = Math.round(cart.subtotal * (tipPct / 100));
  const grandTotal = cart.total + tip;

  // One idempotency key per unique order (amount/params). Stable across pure
  // retries so a lost response can't double-charge; regenerated if the order
  // changes (Clover requires a fresh key when charge params differ).
  const idempotencyKey = useMemo(
    () =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(cart.lines), tip, fulfillment, payment],
  );
  const contactOk = name.trim() && phone.replace(/\D/g, "").length >= 10;
  const deliveryOk = fulfillment === "pickup" || address.trim().length > 4;

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

  async function placeOrder() {
    setStatus("submitting");
    setErrorMsg("");
    try {
      let cardToken: string | undefined;
      if (payment === "card") {
        if (!cardRef.current) throw new Error("Payment fields aren't ready yet — one moment.");
        cardToken = await cardRef.current.tokenize();
      }
      const res = await fetch("/api/order/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fulfillment,
          paymentMethod: payment,
          cardToken,
          idempotencyKey,
          turnstileToken,
          customer: { name, phone, email, address: fulfillment === "delivery" ? address : undefined },
          tipCents: tip,
          orderNote,
          // Send identifiers only — the server prices from its own catalog.
          lines: cart.lines.map((l) => ({
            itemName: l.itemName,
            categoryId: l.categoryId,
            options: l.options.map((o) => ({ group: o.group, name: o.name })),
            quantity: l.quantity,
            notes: l.notes,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Order failed");
      setConfirmed({
        orderId: data.orderId,
        paid: !!data.paid,
        total: grandTotal,
        fulfillment,
        routingIssue: data.routingIssue,
      });
      cart.clear();
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Something went wrong. Please call to order.");
      // The Turnstile token was consumed by this attempt — force a fresh one so a
      // retry isn't rejected for reusing a spent token.
      if (TURNSTILE_ON) {
        setTurnstileToken(null);
        setTurnstileReset((n) => n + 1);
      }
    }
  }

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
          </div>
          <div className="rounded-2xl bg-white p-4 text-sm shadow-[var(--shadow-sm)]">
            <div className="flex justify-between"><span className="text-[var(--color-ink-soft)]">Total</span><span className="font-bold">{money(confirmed.total)}</span></div>
            {confirmed.orderId && <div className="mt-1 flex justify-between"><span className="text-[var(--color-ink-soft)]">Order #</span><span className="font-mono text-xs">{confirmed.orderId.slice(-8).toUpperCase()}</span></div>}
          </div>
          {confirmed.routingIssue && (
            <p className="rounded-xl bg-[var(--color-brand-red)]/8 px-4 py-3 text-sm text-[var(--color-ink)]">
              Your payment went through. Please call <a className="font-semibold text-[var(--color-brand-red)]" href={`tel:${LOCATION.phoneTel}`}>{LOCATION.phone}</a> to confirm we received it.
            </p>
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

  return (
    <Shell onClose={onClose} title="Checkout">
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        {/* Fulfillment */}
        <Segmented
          options={["pickup", "delivery"] as Fulfillment[]}
          value={fulfillment}
          onChange={setFulfillment}
        />

        {/* Contact */}
        <div className="space-y-3">
          <Field label="Name" value={name} onChange={setName} placeholder="Your name" required />
          <Field label="Mobile phone" value={phone} onChange={setPhone} placeholder="(732) 555-0100" type="tel" required />
          <Field label="Email (for your receipt)" value={email} onChange={setEmail} placeholder="you@email.com" type="email" />
          {fulfillment === "delivery" && (
            <Field label="Delivery address" value={address} onChange={setAddress} placeholder="Street, apt, town" required />
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
                onClick={() => setTipPct(p)}
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
              <div className="grid grid-cols-2 gap-2 rounded-full bg-white p-1 shadow-[var(--shadow-sm)]">
                {(["card", "pickup"] as PaymentMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPayment(m)}
                    className={`rounded-full py-2.5 text-sm font-bold transition ${
                      payment === m ? "bg-[var(--color-brand-red)] text-white" : "text-[var(--color-ink)]"
                    }`}
                  >
                    {m === "card" ? "Pay online" : `Pay at ${fulfillment}`}
                  </button>
                ))}
              </div>
              {payment === "card" && (
                <div className="mt-3 space-y-2.5 rounded-2xl bg-white p-4 shadow-[var(--shadow-sm)]">
                  <CardField label="Card number" innerRef={numRef} />
                  <div className="grid grid-cols-2 gap-2.5">
                    <CardField label="Expiry" innerRef={dateRef} />
                    <CardField label="CVV" innerRef={cvvRef} />
                  </div>
                  <CardField label="ZIP" innerRef={postalRef} />
                  {!cardReady && !cardInitFailed && <p className="text-xs text-[var(--color-ink)]/45">Loading secure card fields…</p>}
                  {cardInitFailed && (
                    <div className="rounded-xl bg-[var(--color-brand-red)]/8 px-3 py-2.5 text-xs text-[var(--color-ink)]">
                      Card payment isn't available right now.{" "}
                      <button type="button" onClick={() => setPayment("pickup")} className="font-bold text-[var(--color-brand-red)] underline">
                        Pay at {fulfillment} instead
                      </button>
                    </div>
                  )}
                  <p className="flex items-center gap-1.5 text-[11px] text-[var(--color-ink)]/40">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                    Encrypted & processed by Clover. We never see your card number.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-2xl bg-white p-4 text-sm text-[var(--color-ink-soft)] shadow-[var(--shadow-sm)]">
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

        {/* Review */}
        <div className="rounded-2xl bg-white p-4 shadow-[var(--shadow-sm)]">
          <p className="mb-2 text-sm font-bold text-[var(--color-ink)]">Your order</p>
          <ul className="space-y-1.5 text-sm">
            {cart.lines.map((l) => (
              <li key={l.lineId} className="flex justify-between gap-3 text-[var(--color-ink-soft)]">
                <span className="min-w-0">
                  {l.quantity}× {l.itemName}
                  {l.options.length > 0 && <span className="text-[var(--color-ink)]/45"> — {l.options.map((o) => o.name).join(", ")}</span>}
                </span>
                <span className="shrink-0">{money(lineUnitPrice(l) * l.quantity)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 border-t border-[var(--color-ink)]/8 pt-3 text-sm">
            <Row label="Subtotal" value={money(cart.subtotal)} />
            <Row label="NJ tax (6.625%)" value={money(cart.tax)} />
            {tip > 0 && <Row label={`Tip (${tipPct}%)`} value={money(tip)} />}
            <div className="flex justify-between pt-1 text-base font-bold text-[var(--color-ink)]">
              <dt>Total</dt><dd>{money(grandTotal)}</dd>
            </div>
          </dl>
        </div>

        {status === "error" && (
          <p className="rounded-xl bg-[var(--color-brand-red)]/8 px-4 py-3 text-sm text-[var(--color-ink)]">
            {errorMsg} You can also call <a className="font-semibold text-[var(--color-brand-red)]" href={`tel:${LOCATION.phoneTel}`}>{LOCATION.phone}</a>.
          </p>
        )}
      </div>

      <div className="border-t border-[var(--color-ink)]/10 bg-white p-5">
        {TURNSTILE_ON && <Turnstile onToken={setTurnstileToken} resetSignal={turnstileReset} />}
        <button
          type="button"
          onClick={placeOrder}
          disabled={!contactOk || !deliveryOk || submitting || cart.lines.length === 0 || (payment === "card" && !cardReady) || (TURNSTILE_ON && !turnstileToken)}
          className="flex w-full items-center justify-between rounded-full bg-[var(--color-brand-red)] px-6 py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-[var(--shadow-red)] transition hover:bg-[var(--color-brand-red-bright)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>{submitting ? "Placing order…" : payment === "card" ? "Pay & place order" : "Place order"}</span>
          <span>{money(grandTotal)}</span>
        </button>
        <p className="mt-2 text-center text-[11px] text-[var(--color-ink)]/40">
          {payment === "card"
            ? "Your card is charged securely. Order goes straight to Gigi's kitchen."
            : "Order goes straight to Gigi's kitchen. Pay when you get it."}
        </p>
      </div>
    </Shell>
  );
}

function Shell({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="flex max-h-[94vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-[var(--color-cream)] shadow-[var(--shadow-lg)] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
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

function Segmented({ options, value, onChange }: { options: Fulfillment[]; value: Fulfillment; onChange: (v: Fulfillment) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-full bg-white p-1 shadow-[var(--shadow-sm)]">
      {options.map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => onChange(f)}
          className={`rounded-full py-2.5 text-sm font-bold capitalize transition ${
            value === f ? "bg-[var(--color-brand-red)] text-white" : "text-[var(--color-ink)]"
          }`}
        >
          {f}
        </button>
      ))}
    </div>
  );
}

function CardField({ label, innerRef }: { label: string; innerRef: React.RefObject<HTMLDivElement> }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--color-ink)]/55">{label}</label>
      <div ref={innerRef} className="min-h-[46px] rounded-xl border border-[var(--color-cream-darker)] bg-white px-3 py-3" />
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, type = "text", required,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--color-ink)]/55">
        {label}{required && <span className="text-[var(--color-brand-red)]"> *</span>}
      </label>
      <input
        type={type}
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
