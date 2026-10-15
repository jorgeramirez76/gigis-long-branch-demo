import { savedAttemptUncertain } from "./checkoutAttempt";
import { parsePrice } from "../lib/menuPricing";
const fixedPriceCents = (price?: string) => /^\s*\$\s*[\d,]+(?:\.\d{1,2})?\s*$/.test(price ?? "") ? parsePrice(price) : 0;
import { createContext, useContext, useState, useRef, useEffect, type ReactNode } from "react";
import type { MenuItem } from "../data/menu";
import { getMenuSnapshot } from "../hooks/useMenu";
import { CartProvider, useCart, type CartLine } from "./CartContext";
import { ItemModal } from "./ItemModal";
import { CartDrawer } from "./CartDrawer";
import { LOCATION } from "../data/location";

type CheckoutModule = typeof import("./Checkout");

/**
 * The checkout (with its Clover, Turnstile and VIP-join code) is a separate chunk: it sat in the
 * main bundle, downloaded and parsed before the homepage could hydrate, although only a tap ever
 * uses it. It is now fetched once the page is idle after hydration (and at the latest when the
 * cart opens), so the first screen comes up sooner and the checkout still opens instantly.
 * Fetching it early, not on the tap, also keeps it from the deployment that served the page: a
 * chunk requested minutes later can be gone after a deploy. A failed download is forgotten here,
 * but browsers remember a failed module URL until the page reloads, so the fallback says reload.
 */
let checkoutModule: Promise<CheckoutModule> | null = null;
function loadCheckout(): Promise<CheckoutModule> {
  checkoutModule ??= import("./Checkout").catch((err: unknown) => {
    checkoutModule = null;
    throw err;
  });
  return checkoutModule;
}

type OrderingUI = {
  /** Open the configure-item modal for a menu item (options + quantity). */
  configureItem: (item: MenuItem, categoryId: string) => void;
  /** Whether an item can be ordered online (has a fixed price). */
  isOrderable: (item: MenuItem) => boolean;
};

const UICtx = createContext<OrderingUI | null>(null);

export function useOrderingUI(): OrderingUI {
  const ctx = useContext(UICtx);
  if (!ctx) throw new Error("useOrderingUI must be used within <OrderingProvider>");
  return ctx;
}

export function OrderingProvider({ children }: { children: ReactNode }) {
  return (
    <CartProvider>
      <OrderingInner>{children}</OrderingInner>
    </CartProvider>
  );
}

function OrderingInner({ children }: { children: ReactNode }) {
  const cart = useCart();
  const [active, setActive] = useState<{ item: MenuItem; categoryId: string; existingLine?: CartLine } | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [CheckoutView, setCheckoutView] = useState<CheckoutModule["Checkout"] | null>(null);
  const [checkoutLoadFailed, setCheckoutLoadFailed] = useState(false);
  const [cartNotice, setCartNotice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const restoreEditFocus = useRef<string | null>(null);

  useEffect(() => {
    if (!cart.isOpen || active || !restoreEditFocus.current) return;
    const id = restoreEditFocus.current;
    const frame = requestAnimationFrame(() => {
      Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-edit-line]")).find(button => button.dataset.editLine === id)?.focus();
      restoreEditFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [cart.isOpen, active]);

  // Fetch the checkout chunk once the browser is idle after hydration (where requestIdleCallback
  // is missing, as in older Safari, it waits two seconds instead).
  useEffect(() => {
    const load = () => {
      loadCheckout()
        .then((m) => setCheckoutView(() => m.Checkout))
        .catch(() => { /* tried again when the cart opens or Checkout is tapped */ });
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    if (w.requestIdleCallback) {
      const handle = w.requestIdleCallback(load, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(load, 2000);
    return () => window.clearTimeout(timer);
  }, []);

  // When the cart opens, make sure the checkout is here and start loading Clover's card SDK.
  useEffect(() => {
    if (!cart.isOpen) return;
    loadCheckout()
      .then((m) => {
        setCheckoutView(() => m.Checkout);
        m.warmCheckout();
      })
      .catch(() => { /* tried again when Checkout is tapped, with a visible error if it still fails */ });
  }, [cart.isOpen]);

  function fetchCheckout() {
    setCheckoutLoadFailed(false);
    loadCheckout()
      .then((m) => setCheckoutView(() => m.Checkout))
      .catch(() => setCheckoutLoadFailed(true));
  }

  async function editLine(line: CartLine) {
    if (savedAttemptUncertain() || editingId) return;
    setEditingId(line.lineId);
    setCartNotice("");
    const categories = await getMenuSnapshot();
    setEditingId(null);
    if (savedAttemptUncertain()) return;
    const item = categories.find(category => category.id === line.categoryId)?.items.find(candidate => candidate.name === line.itemName);
    if (!item || fixedPriceCents(item.price) <= 0) {
      setCartNotice(`${line.itemName} is no longer available to customize online. Remove it and choose another item, or call the store.`);
      return;
    }
    restoreEditFocus.current = line.lineId;
    cart.closeCart();
    setActive({ item, categoryId: line.categoryId, existingLine: line });
  }


  const ui: OrderingUI = {
    configureItem: (item, categoryId) => {
      if (savedAttemptUncertain()) { cart.openCart(); return; }
      setActive({ item, categoryId });
    },
    isOrderable: (item) => fixedPriceCents(item.price) > 0,
  };

  return (
    <UICtx.Provider value={ui}>
      {children}
      {active && (
        <ItemModal key={active.existingLine?.lineId ?? `${active.categoryId}:${active.item.name}`} item={active.item} categoryId={active.categoryId} existingLine={active.existingLine} onClose={() => {
          const wasEditing = !!active.existingLine;
          setActive(null);
          if (wasEditing) cart.openCart();
        }} />
      )}
      <CartDrawer
        onEdit={editLine}
        editingId={editingId}
        notice={cartNotice}
        onCheckout={() => {
          cart.closeCart();
          setCheckoutOpen(true);
          if (!CheckoutView) fetchCheckout();
        }}
      />
      {checkoutOpen && (CheckoutView
        ? <CheckoutView onClose={() => setCheckoutOpen(false)} />
        : <CheckoutLoading failed={checkoutLoadFailed} onClose={() => setCheckoutOpen(false)} />)}
    </UICtx.Provider>
  );
}

/** Shown only while the checkout chunk is still downloading (it normally arrived long before the
 *  tap), or when it could not be downloaded. The cart lives in localStorage, so a reload is safe. */
function CheckoutLoading({ failed, onClose }: { failed: boolean; onClose: () => void }) {
  const actionRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    actionRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [failed, onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Checkout">
      <div className="w-full max-w-lg rounded-t-3xl bg-[var(--color-page)] p-6 text-center shadow-[var(--shadow-lg)] sm:rounded-3xl">
        {failed ? (
          <>
            <p role="alert" className="text-base text-[var(--color-copy)]">
              Checkout didn't load. Check your connection and reload the page — your cart is saved. You can also call{" "}
              <a className="font-bold text-[var(--color-action-text)] underline" href={`tel:${LOCATION.phoneTel}`}>{LOCATION.phone}</a>.
            </p>
            <div className="mt-4 flex justify-center">
              <button ref={actionRef} type="button" onClick={() => window.location.reload()} className="btn-primary">Reload page</button>
            </div>
          </>
        ) : (
          <p aria-live="polite" className="text-base text-[var(--color-copy-soft)]">Loading checkout…</p>
        )}
        <button ref={failed ? undefined : actionRef} type="button" onClick={onClose} className="mt-4 text-sm font-semibold text-[var(--color-copy-muted)] underline">Close</button>
      </div>
    </div>
  );
}
