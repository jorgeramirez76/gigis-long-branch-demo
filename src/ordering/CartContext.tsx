import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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
  openCart: () => void;
  closeCart: () => void;
};

const CartCtx = createContext<CartState | null>(null);
const STORAGE_KEY = "gigis_cart_v1";

/** cents → "$12.34" */
export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Parse a display price like "$17.68" or "+$1.04" to integer cents. */
export function parsePrice(display?: string | null): number {
  if (!display) return 0;
  const m = display.replace(/[^0-9.]/g, "");
  if (!m) return 0;
  return Math.round(parseFloat(m) * 100);
}

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

let lineCounter = 0;

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => {
    try {
      const raw = typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isValidLine).map((l) => ({ ...l, quantity: clampQty(l.quantity) }));
    } catch {
      return [];
    }
  });
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
      },
      updateQty: (lineId, quantity) =>
        setLines((prev) =>
          quantity <= 0
            ? prev.filter((l) => l.lineId !== lineId)
            : prev.map((l) => (l.lineId === lineId ? { ...l, quantity: clampQty(quantity) } : l)),
        ),
      removeLine: (lineId) => setLines((prev) => prev.filter((l) => l.lineId !== lineId)),
      clear: () => setLines([]),
      count: lines.reduce((s, l) => s + l.quantity, 0),
      subtotal,
      tax,
      total: subtotal + tax,
      isOpen,
      openCart: () => setIsOpen(true),
      closeCart: () => setIsOpen(false),
    };
  }, [lines, isOpen]);

  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export function useCart(): CartState {
  const ctx = useContext(CartCtx);
  if (!ctx) throw new Error("useCart must be used within <CartProvider>");
  return ctx;
}
