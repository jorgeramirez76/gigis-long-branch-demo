import { useEffect, useRef } from "react";
import { lineUnitPrice, money, useCart } from "./CartContext";
import { placementSuffix } from "../data/menuToppings";
import { Upsell } from "./Upsell";
import { goToMenu } from "../lib/goToMenu";

export function CartDrawer({ onCheckout }: { onCheckout: () => void }) {
  const cart = useCart();
  const panelRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.inert = !cart.isOpen;
    if (!cart.isOpen) return;

    const restoreTo = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const hidden: Array<{ el: HTMLElement; aria: string | null; inert: boolean }> = [];
    for (const sibling of Array.from(panel.parentElement?.children ?? [])) {
      if (sibling === panel || sibling === scrimRef.current || !(sibling instanceof HTMLElement)) continue;
      hidden.push({ el: sibling, aria: sibling.getAttribute("aria-hidden"), inert: sibling.inert });
      sibling.setAttribute("aria-hidden", "true");
      sibling.inert = true;
    }
    panel.querySelector<HTMLElement>("button")?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cart.closeCart();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(
        "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])",
      )).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      for (const item of hidden) {
        if (item.aria == null) item.el.removeAttribute("aria-hidden");
        else item.el.setAttribute("aria-hidden", item.aria);
        item.el.inert = item.inert;
      }
      restoreTo?.focus?.();
    };
  }, [cart.isOpen]);

  return (
    <>
      {/* Scrim */}
      <div
        ref={scrimRef}
        className={`fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${
          cart.isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={cart.closeCart}
        aria-hidden="true"
      />
      {/* Panel */}
      <aside
        ref={panelRef}
        aria-label="Your order"
        aria-hidden={!cart.isOpen}
        role="dialog"
        aria-modal={cart.isOpen || undefined}
        className={`fixed inset-y-0 right-0 z-[56] flex w-full max-w-md flex-col bg-[var(--color-cream)] shadow-[var(--shadow-lg)] transition-transform duration-300 ease-out ${
          cart.isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-[var(--color-ink)]/10 bg-white px-5 py-4">
          <h2 className="font-display text-2xl text-[var(--color-ink)]">
            Your order{cart.count > 0 && <span className="text-[var(--color-brand-red)]"> · {cart.count}</span>}
          </h2>
          <button
            type="button"
            onClick={cart.closeCart}
            aria-label="Close cart"
            className="rounded-full p-2 text-[var(--color-ink)]/50 hover:bg-[var(--color-cream)]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        {cart.droppedOnLoad > 0 && (
          <p role="status" className="mx-5 mt-4 rounded-xl bg-[var(--color-brand-red)]/8 px-4 py-3 text-sm text-[var(--color-ink)]">
            {cart.droppedOnLoad === 1 ? "An item" : `${cart.droppedOnLoad} items`} from your saved order{" "}
            {cart.droppedOnLoad === 1 ? "is" : "are"} no longer on the menu, so {cart.droppedOnLoad === 1 ? "it was" : "they were"} removed.
          </p>
        )}

        {cart.lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="text-5xl">🍕</div>
            <p className="font-display text-2xl text-[var(--color-ink)]">Your cart is empty</p>
            <p className="text-sm text-[var(--color-ink-soft)]">
              Browse the menu and tap an item to build your order.
            </p>
            <button
              type="button"
              onClick={() => {
                // Closing alone left the customer exactly where they were, with the menu
                // still thousands of pixels away — the button promised the menu and
                // delivered nothing. Take them there.
                cart.closeCart();
                goToMenu();
              }}
              className="mt-2 rounded-full border-2 border-[var(--color-ink)]/15 px-6 py-3 text-sm font-bold uppercase tracking-wide text-[var(--color-ink)] transition hover:border-[var(--color-brand-red)]"
            >
              Browse the menu
            </button>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-[var(--color-ink)]/8 overflow-y-auto px-5">
              {cart.lines.map((l) => (
                <li key={l.lineId} className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-serif text-base font-semibold text-[var(--color-ink)]">{l.itemName}</p>
                      {l.options.length > 0 && (
                        <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                          {l.options.map((o) => o.name + placementSuffix(o.placement)).join(", ")}
                        </p>
                      )}
                      {l.notes && <p className="mt-0.5 text-xs italic text-[var(--color-ink)]/50">“{l.notes}”</p>}
                    </div>
                    <span className="shrink-0 font-semibold text-[var(--color-ink)]">
                      {money(lineUnitPrice(l) * l.quantity)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center rounded-full border border-[var(--color-ink)]/15 bg-white">
                      <button
                        type="button"
                        aria-label="Decrease"
                        onClick={() => cart.updateQty(l.lineId, l.quantity - 1)}
                        className="px-3 py-1 text-[var(--color-ink)]"
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-sm font-semibold">{l.quantity}</span>
                      <button
                        type="button"
                        aria-label="Increase"
                        onClick={() => cart.updateQty(l.lineId, l.quantity + 1)}
                        className="px-3 py-1 text-[var(--color-ink)]"
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => cart.removeLine(l.lineId)}
                      className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink)]/40 hover:text-[var(--color-brand-red)]"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <Upsell />

            <footer className="border-t border-[var(--color-ink)]/10 bg-white px-5 py-4">
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between text-[var(--color-ink-soft)]">
                  <dt>Subtotal</dt>
                  <dd>{money(cart.subtotal)}</dd>
                </div>
                <div className="flex justify-between text-[var(--color-ink-soft)]">
                  <dt>NJ tax (6.625%)</dt>
                  <dd>{money(cart.tax)}</dd>
                </div>
                <div className="flex justify-between border-t border-[var(--color-ink)]/8 pt-1.5 text-base font-bold text-[var(--color-ink)]">
                  <dt>Total</dt>
                  <dd>{money(cart.total)}</dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={onCheckout}
                className="mt-4 w-full rounded-full bg-[var(--color-brand-red)] px-6 py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-[var(--shadow-red)] transition hover:bg-[var(--color-brand-red-bright)]"
              >
                Checkout · {money(cart.total)}
              </button>
              <p className="mt-2 text-center text-[11px] text-[var(--color-ink)]/40">
                Tip and pickup time added at checkout. Final total confirmed by our register.
              </p>
            </footer>
          </>
        )}
      </aside>
    </>
  );
}
