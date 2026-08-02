import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { findCatalogItem, optionDelta, placementEligible } from "../lib/menuPricing";
import { isToppingPlacement } from "../data/menuToppings";

/** NJ Sales Tax pulled from the merchant's Clover config (6.625%). Applied to
 * the taxable subtotal; the final authoritative total is re-computed by Clover
 * at charge time, this is for the on-page display. */
export const TAX_RATE = 0.06625;

export type CartOption = { group: string; name: string; delta: number; placement?: "whole" | "left" | "right" };

export type CartLine = {
  /** unique per cart line (same item + different options = different lines) */
  lineId: string;
  itemName: string;
  categoryId: string;
  basePrice: number; // cents
  options: CartOption[];
  quantity: number;
  notes?: string;
};

/** Unit price (base + option deltas) in cents. */
export function lineUnitPrice(line: Pick<CartLine, "basePrice" | "options">): number {
  return line.basePrice + line.options.reduce((s, o) => s + o.delta, 0);
}
export function lineTotal(line: CartLine): number {
  return lineUnitPrice(line) * line.quantity;
}

type CartState = {
  lines: CartLine[];
  addLine: (line: Omit<CartLine, "lineId">) => void;
  updateQty: (lineId: string, quantity: number) => void;
  removeLine: (lineId: string) => void;
  clear: () => void;
  count: number;
  subtotal: number;
  tax: number;
  total: number;
  isOpen: boolean;
  /** How many saved lines were dropped on load because they left the menu. */
  droppedOnLoad: number;
  openCart: () => void;
  closeCart: () => void;
};

const CartCtx = createContext<CartState | null>(null);
const STORAGE_KEY = "gigis_cart_v1";

/** cents → "$12.34" */
export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export { parsePrice } from "../lib/menuPricing";

/** Per-line quantity cap (mirrors the server's per-line bound). */
export const MAX_LINE_QTY = 50;

const clampQty = (q: number) => Math.min(Math.max(1, Math.floor(q)), MAX_LINE_QTY);

/** Guard hydrated localStorage against malformed/tampered shapes that would crash the cart. */
function isValidLine(l: unknown): l is CartLine {
  const x = l as CartLine;
  return (
    !!x &&
    typeof x.lineId === "string" &&
    typeof x.itemName === "string" &&
    typeof x.basePrice === "number" &&
    Number.isFinite(x.basePrice) &&
    Number.isFinite(x.quantity) &&
    x.quantity > 0 &&
    Array.isArray(x.options) &&
    x.options.every(
      (o) =>
        o &&
        typeof o.name === "string" &&
        typeof o.delta === "number" &&
        Number.isFinite(o.delta) &&
        (o.placement == null || o.placement === "whole" || o.placement === "left" || o.placement === "right"),
    )
  );
}

/**
 * Re-price a line restored from localStorage against the current menu, or drop it.
 *
 * A saved cart keeps whatever the item cost when it was added, which can be weeks
 * old. The server always charges from its own catalog, so a stale line would show
 * the customer one total and charge another — quietly, because the confirmation
 * screen displays the server's figure. Anything no longer on the menu (or now
 * priced by quote) is removed here rather than failing at checkout.
 */
function repriceStoredLine(l: CartLine): CartLine | null {
  const item = findCatalogItem(l.itemName, l.categoryId);
  if (!item) return null;
  const options: CartOption[] = [];
  for (const o of l.options) {
    // Carts saved before placement existed carry topping options without one —
    // normalize to "whole" so they price, print, and merge exactly like new lines.
    const placement = placementEligible(item, o)
      ? isToppingPlacement(o.placement) ? o.placement : "whole"
      : undefined;
    const delta = optionDelta(item, { ...o, placement });
    if (delta == null) return null;
    options.push({ ...o, placement, delta });
  }
  if (item.basePrice + options.reduce((s, o) => s + o.delta, 0) <= 0) return null;
  return { ...l, basePrice: item.basePrice, options };
}

let lineCounter = 0;

export function CartProvider({ children }: { children: ReactNode }) {
  // Start EMPTY and restore the saved cart after mount. The page is prerendered
  // (vite-react-ssg) with an empty cart, so reading localStorage during the
  // first render made every returning customer's first paint mismatch the
  // server HTML — ten hydration errors and a full client re-render on the live
  // site until the saved cart was cleared.
  const [lines, setLines] = useState<CartLine[]>([]);
  const [dropped, setDropped] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  // Blocks the persist effect until the restore has run, so the initial empty
  // state can't overwrite the saved cart it is about to load.
  const restored = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter(isValidLine);
          const kept = valid
            .map((l) => repriceStoredLine({ ...l, quantity: clampQty(l.quantity) }))
            .filter((l): l is CartLine => l !== null);
          setLines(kept);
          // Say what the menu no longer sells, rather than quietly handing back
          // a shorter order than the customer left. Cleared on any cart change.
          setDropped(valid.length - kept.length);
        }
      }
    } catch {
      /* unreadable saved cart — start fresh */
    }
    restored.current = true;
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* ignore quota / private mode */
    }
  }, [lines]);

  const value = useMemo<CartState>(() => {
    const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
    const tax = Math.round(subtotal * TAX_RATE);
    return {
      lines,
      addLine: (line) => {
        // merge identical lines (same item + same options + no notes)
        const key = (l: Pick<CartLine, "itemName" | "options" | "notes">) =>
          l.itemName + "|" + l.options.map((o) => o.group + ":" + o.name + ":" + (o.placement ?? "")).sort().join(",") + "|" + (l.notes ?? "");
        setLines((prev) => {
          const idx = prev.findIndex((l) => key(l) === key(line));
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], quantity: clampQty(next[idx].quantity + line.quantity) };
            return next;
          }
          lineCounter += 1;
          return [...prev, { ...line, quantity: clampQty(line.quantity), lineId: `l${Date.now()}_${lineCounter}` }];
        });
        setIsOpen(true);
        setDropped(0);
      },
      updateQty: (lineId, quantity) =>
        setLines((prev) =>
          quantity <= 0
            ? prev.filter((l) => l.lineId !== lineId)
            : prev.map((l) => (l.lineId === lineId ? { ...l, quantity: clampQty(quantity) } : l)),
        ),
      removeLine: (lineId) => setLines((prev) => prev.filter((l) => l.lineId !== lineId)),
      clear: () => {
        setLines([]);
        setDropped(0);
      },
      count: lines.reduce((s, l) => s + l.quantity, 0),
      subtotal,
      tax,
      total: subtotal + tax,
      isOpen,
      droppedOnLoad: dropped,
      openCart: () => setIsOpen(true),
      closeCart: () => setIsOpen(false),
    };
  }, [lines, isOpen, dropped]);

  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export function useCart(): CartState {
  const ctx = useContext(CartCtx);
  if (!ctx) throw new Error("useCart must be used within <CartProvider>");
  return ctx;
}
