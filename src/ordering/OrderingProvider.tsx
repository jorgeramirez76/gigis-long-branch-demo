import { createContext, useContext, useState, type ReactNode } from "react";
import type { MenuItem } from "../data/menu";
import { CartProvider, useCart, parsePrice } from "./CartContext";
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
  const [active, setActive] = useState<{ item: MenuItem; categoryId: string } | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const ui: OrderingUI = {
    configureItem: (item, categoryId) => setActive({ item, categoryId }),
    isOrderable: (item) => parsePrice(item.price) > 0,
  };

  return (
    <UICtx.Provider value={ui}>
      {children}
      {active && (
        <ItemModal item={active.item} categoryId={active.categoryId} onClose={() => setActive(null)} />
      )}
      <CartDrawer
        onCheckout={() => {
          cart.closeCart();
          setCheckoutOpen(true);
        }}
      />
      {checkoutOpen && <Checkout onClose={() => setCheckoutOpen(false)} />}
    </UICtx.Provider>
  );
}
