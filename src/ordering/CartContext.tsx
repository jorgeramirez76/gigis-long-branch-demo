import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { findCatalogItem, optionDelta } from "../lib/menuPricing";

/** NJ Sales Tax pulled from the merchant's Clover config (6.625%). Applied to
 * the taxable subtotal; the final authoritative total is re-computed by Clover
 * at charge time, this is for the on-page display. */
export const TAX_RATE = 0.06625;

export type CartOption = { group: string; name: string; delta: number };

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
      (o) => o && typeof o.name === "string" && typeof o.delta === "number" && Number.isFinite(o.delta),
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
    const delta = optionDelta(item, o);
    if (delta == null) return null;
    options.push({ ...o, delta });
  }
  if (item.basePrice + options.reduce((s, o) => s + o.delta, 0) <= 0) return null;
  return { ...l, basePrice: item.basePrice, options };
}

let lineCounter = 0;
/** Lines removed during hydration because they left the menu (see repriceStoredLine). */
let droppedOnLoad = 0;

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => {
    try {
      const raw = typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const valid = parsed.filter(isValidLine);
      const kept = valid
        .map((l) => repriceStoredLine({ ...l, quantity: clampQty(l.quantity) }))
        .filter((l): l is CartLine => l !== null);
      // Remember what the menu no longer sells so the cart can say so, rather
      // than quietly handing back a shorter order than the customer left.
      droppedOnLoad = valid.length - kept.length;
      return kept;
    } catch {
      return [];
    }
  });
  // Read the hydration tally captured by the initializer above. Cleared as soon
  // as the customer changes the cart, so the notice doesn't linger.
  const [dropped, setDropped] = useState(() => droppedOnLoad);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
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
          l.itemName + "|" + l.options.map((o) => o.group + ":" + o.name).sort().join(",") + "|" + (l.notes ?? "");
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
