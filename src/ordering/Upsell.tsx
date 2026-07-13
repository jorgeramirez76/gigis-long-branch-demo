import { money, useCart } from "./CartContext";

/**
 * In-cart upsell — three "add these to your order" suggestions with one-tap add.
 * Curated to quick-add items (no required options), high-margin impulse buys.
 * Prices mirror the live Clover menu (src/data/menuGenerated.ts).
 */
const SUGGESTIONS = [
  { itemName: "Garlic Knots", categoryId: "slices", basePrice: 624, tag: "Most added" },
  { itemName: "Mozzarella Sticks (6)", categoryId: "appetizers", basePrice: 1040, tag: "Crowd favorite" },
  { itemName: "Cannoli (2)", categoryId: "desserts", basePrice: 623, tag: "Sweet finish" },
  { itemName: "French Fries", categoryId: "french-fries", basePrice: 416, tag: "Classic side" },
  { itemName: "Two Liter Soda", categoryId: "drinks", basePrice: 300, tag: "For the table" },
];

export function Upsell() {
  const cart = useCart();
  const inCart = new Set(cart.lines.map((l) => l.itemName));
  const picks = SUGGESTIONS.filter((s) => !inCart.has(s.itemName)).slice(0, 3);
  if (picks.length === 0) return null;

  return (
    <div className="border-t border-[var(--color-ink)]/10 bg-[var(--color-cream-dark)] px-5 py-4">
      <p className="mb-2.5 text-xs font-bold uppercase tracking-wider text-[var(--color-ink)]/55">
        Add these to your order
      </p>
      <div className="space-y-2">
        {picks.map((s) => (
          <div
            key={s.itemName}
            className="flex items-center justify-between gap-3 rounded-xl bg-white px-3.5 py-2.5 shadow-[var(--shadow-sm)]"
          >
            <div className="min-w-0">
              <p className="truncate font-serif text-sm font-semibold text-[var(--color-ink)]">{s.itemName}</p>
              <p className="text-[11px] text-[var(--color-ink)]/45">
                {s.tag} · <span className="font-semibold text-[var(--color-brand-red)]">{money(s.basePrice)}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                cart.addLine({ itemName: s.itemName, categoryId: s.categoryId, basePrice: s.basePrice, options: [], quantity: 1 })
              }
              aria-label={`Add ${s.itemName}`}
              className="shrink-0 rounded-full border border-[var(--color-brand-red)] px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-[var(--color-brand-red)] transition hover:bg-[var(--color-brand-red)] hover:text-white"
            >
              + Add
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
