import { savedAttemptUncertain } from "./Checkout";
import { parsePrice } from "../lib/menuPricing";
const fixedPriceCents = (price?: string) => /^\s*\$\s*[\d,]+(?:\.\d{1,2})?\s*$/.test(price ?? "") ? parsePrice(price) : 0;
import { createContext, useContext, useState, useRef, useEffect, type ReactNode } from "react";
import type { MenuItem } from "../data/menu";
import { getMenuSnapshot } from "../hooks/useMenu";
import { CartProvider, useCart, type CartLine } from "./CartContext";
import { ItemModal } from "./ItemModal";
import { CartDrawer } from "./CartDrawer";
import { Checkout } from "./Checkout";

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
        }}
      />
      {checkoutOpen && <Checkout onClose={() => setCheckoutOpen(false)} />}
    </UICtx.Provider>
  );
}
