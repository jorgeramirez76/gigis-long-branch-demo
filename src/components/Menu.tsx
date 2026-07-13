import { useEffect, useMemo, useRef, useState } from "react";
import { MENU, PRICING_DISCLAIMER, MENU_VERIFIED } from "../data/menu";
import type { MenuItem } from "../data/menu";
import { LOCATION } from "../data/location";
import { PhoneIcon } from "./Icons";
import { useOrderingUI } from "../ordering/OrderingProvider";
import { useCart } from "../ordering/CartContext";

/** One orderable menu line. The whole row opens the item modal (options +
 * quantity → add to cart). `categoryLabel` is shown only in search results. */
function MenuItemRow({ item, categoryId, categoryLabel }: { item: MenuItem; categoryId: string; categoryLabel?: string }) {
  const { configureItem, isOrderable } = useOrderingUI();
  const orderable = isOrderable(item);
  const hasOptions = !!item.options && item.options.length > 0;

  const info = (
    <div className="min-w-0 flex-1">
      {categoryLabel && (
        <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-brand-red)]/70">
          {categoryLabel}
        </p>
      )}
      <p className="font-serif text-[17px] font-semibold text-[var(--color-ink)] md:text-lg">
        {item.name}
        {item.popular && (
          <span className="ml-2 inline-flex items-center rounded-full bg-[var(--color-brand-red)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-brand-red)]">
            Popular
          </span>
        )}
      </p>
      {item.description && (
        <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink-soft)]">{item.description}</p>
      )}
      {hasOptions && orderable && (
        <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-brand-red)]/60">
          Customizable · toppings &amp; options
        </p>
      )}
    </div>
  );

  if (!orderable) {
    return (
      <li className="flex items-baseline justify-between gap-4 border-b border-dotted border-[var(--color-ink)]/15 pb-4">
        {info}
        <span className="shrink-0 text-xs font-medium uppercase tracking-wider text-[var(--color-ink)]/50">
          Call to confirm
        </span>
      </li>
    );
  }

  return (
    <li className="border-b border-dotted border-[var(--color-ink)]/15">
      <button
        type="button"
        onClick={() => configureItem(item, categoryId)}
        className="group/item flex w-full items-center justify-between gap-4 rounded-lg pb-4 text-left transition"
      >
        {info}
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="font-display text-xl text-[var(--color-brand-red)]">{item.price}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-brand-red)] px-3.5 py-1 text-xs font-bold uppercase tracking-wide text-white shadow-[var(--shadow-red)] transition group-hover/item:bg-[var(--color-brand-red-bright)]">
            Add +
          </span>
        </span>
      </button>
    </li>
  );
}

export function Menu() {
  const [activeId, setActiveId] = useState<string>(MENU[0]?.id ?? "pizza");
  const [query, setQuery] = useState("");
  const active = MENU.find((c) => c.id === activeId) ?? MENU[0];
  const panelRef = useRef<HTMLDivElement>(null);
  const cart = useCart();

  const q = query.trim().toLowerCase();
  const searching = q.length >= 2;

  // Flattened cross-category matches on item name or category name.
  const results = useMemo(() => {
    if (!searching) return [];
    return MENU.flatMap((c) =>
      c.items
        .filter((it) => it.name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
        .map((it) => ({ item: it, category: c.name, categoryId: c.id })),
    );
  }, [q, searching]);

  // Small fade transition when the view changes.
  const [fadeKey, setFadeKey] = useState(0);
  useEffect(() => {
    setFadeKey((k) => k + 1);
  }, [activeId, searching]);

  return (
    <section
      id="menu"
      className="scroll-mt-20 overflow-hidden bg-[var(--color-cream-dark)] py-20 md:py-28"
    >
      <div className="container-x">
        <div className="mx-auto max-w-2xl text-center" data-reveal>
          <span className="eyebrow">The full menu</span>
          <h2 className="mt-3 text-4xl md:text-6xl">Our full Long Branch menu</h2>
          <p className="mt-4 text-base text-[var(--color-ink-soft)] md:text-lg">
            NY pies, Grandma squares, specialty pizzas, heroes, pasta, and Italian
            dinners — plus gluten-free &amp; vegan pizza, breakfast, and açaí. Straight
            from our Clover kitchen, updated July 2026.
          </p>
        </div>

        {/* Search */}
        <div className="mx-auto mt-8 max-w-md" data-reveal>
          <div className="relative">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the menu — “grandma”, “buffalo”, “omelette”…"
              aria-label="Search the menu"
              className="w-full rounded-full border border-[var(--color-cream-darker)] bg-white py-3 pl-11 pr-4 text-sm shadow-[var(--shadow-sm)] focus:border-[var(--color-brand-red)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-red)]/20"
            />
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-mute)]"
            >
              <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="2" />
              <path d="m14 14 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        {/* Category tabs — hidden while searching */}
        {!searching && (
          <div
            className="scrollbar-none relative mt-8 -mx-5 flex w-[calc(100%+2.5rem)] min-w-0 max-w-[calc(100%+2.5rem)] gap-2 overflow-x-auto px-5 pb-2 md:mx-0 md:w-auto md:min-w-0 md:max-w-none md:flex-wrap md:justify-center md:overflow-visible md:px-0"
            role="tablist"
            aria-label="Menu categories"
            data-reveal
          >
            {MENU.map((c) => {
              const on = c.id === activeId;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setActiveId(c.id)}
                  className={`min-h-[44px] shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200 md:px-5 md:py-2.5 ${
                    on
                      ? "bg-[var(--color-brand-red)] text-white shadow-[var(--shadow-red)]"
                      : "bg-white text-[var(--color-ink)] hover:bg-[var(--color-brand-red)]/10 hover:text-[var(--color-brand-red)]"
                  }`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        )}

        {/* Panel */}
        <div
          ref={panelRef}
          className="mt-10 rounded-3xl bg-white p-6 shadow-[var(--shadow-lg)] md:p-10"
          data-reveal
        >
          <div key={fadeKey} className="hero-in" style={{ animationDuration: "0.4s" }}>
            {searching ? (
              <>
                <div className="mb-8 flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--color-ink)]/8 pb-6">
                  <h3 className="font-display text-3xl md:text-4xl">
                    {results.length} {results.length === 1 ? "result" : "results"}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="text-sm font-semibold text-[var(--color-brand-red)] underline"
                  >
                    Clear search
                  </button>
                </div>
                {results.length > 0 ? (
                  <ul className="grid gap-x-10 gap-y-5 md:grid-cols-2">
                    {results.map(({ item, category, categoryId }) => (
                      <MenuItemRow key={`${category}-${item.name}`} item={item} categoryId={categoryId} categoryLabel={category} />
                    ))}
                  </ul>
                ) : (
                  <p className="py-6 text-center text-[var(--color-ink-soft)]">
                    Nothing matches “{query.trim()}”. Try another word, browse the categories, or call{" "}
                    {LOCATION.phone}.
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="mb-8 border-b border-[var(--color-ink)]/8 pb-6">
                  <h3 className="font-display text-3xl md:text-4xl">{active.name}</h3>
                  {active.blurb && (
                    <p className="mt-2 text-sm text-[var(--color-ink-soft)] md:text-base">{active.blurb}</p>
                  )}
                </div>
                <ul className="grid gap-x-10 gap-y-5 md:grid-cols-2">
                  {active.items.map((item) => (
                    <MenuItemRow key={item.name} item={item} categoryId={active.id} />
                  ))}
                </ul>
              </>
            )}
          </div>

          {!MENU_VERIFIED && (
            <p className="mt-10 rounded-xl bg-[var(--color-cream-dark)] p-5 text-center text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {PRICING_DISCLAIMER}
            </p>
          )}
        </div>

        {/* CTA row below the menu */}
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row" data-reveal>
          <a href={`tel:${LOCATION.phoneTel}`} className="btn-primary w-full sm:w-auto">
            <PhoneIcon className="h-4 w-4" />
            Call ahead for pickup · {LOCATION.phone}
          </a>
          <button type="button" onClick={cart.openCart} className="btn-gold w-full sm:w-auto">
            {cart.count > 0 ? `View your order · ${cart.count}` : "Start your order"}
          </button>
        </div>
        {MENU_VERIFIED && (
          <p className="mt-6 text-center text-xs text-[var(--color-ink)]/50">{PRICING_DISCLAIMER}</p>
        )}
      </div>
    </section>
  );
}
