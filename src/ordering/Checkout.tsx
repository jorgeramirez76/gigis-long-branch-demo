import { useState } from "react";
import { lineUnitPrice, money, useCart } from "./CartContext";
import { LOCATION } from "../data/location";

type Fulfillment = "pickup" | "delivery";
const TIP_PCTS = [0, 10, 15, 20];

export function Checkout({ onClose }: { onClose: () => void }) {
  const cart = useCart();
  const [fulfillment, setFulfillment] = useState<Fulfillment>("pickup");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [tipPct, setTipPct] = useState(15);
  const [orderNote, setOrderNote] = useState("");
  const [status, setStatus] = useState<"form" | "submitting" | "error">("form");
  const [errorMsg, setErrorMsg] = useState("");

  const tip = Math.round(cart.subtotal * (tipPct / 100));
  const grandTotal = cart.total + tip;
  const contactOk = name.trim() && phone.replace(/\D/g, "").length >= 10;
  const deliveryOk = fulfillment === "pickup" || address.trim().length > 4;

  async function placeOrder() {
    setStatus("submitting");
    setErrorMsg("");
    try {
      const res = await fetch("/api/order/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fulfillment,
          customer: { name, phone, email, address: fulfillment === "delivery" ? address : undefined },
          tip,
          orderNote,
          lines: cart.lines,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Order failed");
      // Stage 2 wires the Clover secure card field here and redirects to
      // confirmation. Until then, surface a clear message.
      setStatus("error");
      setErrorMsg(data.message || "Ordering is almost ready — card payment is being finalized.");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Something went wrong. Please call to order.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Checkout"
      onClick={onClose}
    >
      <div
        className="flex max-h-[94vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-[var(--color-cream)] shadow-[var(--shadow-lg)] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--color-ink)]/10 bg-white px-5 py-4">
          <h2 className="font-display text-2xl text-[var(--color-ink)]">Checkout</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-[var(--color-ink)]/50 hover:bg-[var(--color-cream)]">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Fulfillment */}
          <div className="grid grid-cols-2 gap-2 rounded-full bg-white p-1 shadow-[var(--shadow-sm)]">
            {(["pickup", "delivery"] as Fulfillment[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFulfillment(f)}
                className={`rounded-full py-2.5 text-sm font-bold capitalize transition ${
                  fulfillment === f ? "bg-[var(--color-brand-red)] text-white" : "text-[var(--color-ink)]"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

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
          <button
            type="button"
            onClick={placeOrder}
            disabled={!contactOk || !deliveryOk || status === "submitting" || cart.lines.length === 0}
            className="flex w-full items-center justify-between rounded-full bg-[var(--color-brand-red)] px-6 py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-[var(--shadow-red)] transition hover:bg-[var(--color-brand-red-bright)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>{status === "submitting" ? "Placing order…" : "Continue to payment"}</span>
            <span>{money(grandTotal)}</span>
          </button>
          <p className="mt-2 text-center text-[11px] text-[var(--color-ink)]/40">
            Secure card payment on the next step. Orders go straight to Gigi's kitchen.
          </p>
        </div>
      </div>
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
