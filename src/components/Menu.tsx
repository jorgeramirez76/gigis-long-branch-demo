import { useEffect, useMemo, useRef, useState } from "react";
import { MENU, PRICING_DISCLAIMER, MENU_VERIFIED } from "../data/menu";
import type { MenuItem } from "../data/menu";
import { LOCATION, ORDER_ONLINE_URL } from "../data/location";
import { ArrowIcon, PhoneIcon } from "./Icons";

/** One menu line — name, popular flag, description, expandable options, price.
 * `categoryLabel` is shown only in search results so a hit is placeable. */
function MenuItemRow({ item, categoryLabel }: { item: MenuItem; categoryLabel?: string }) {
  return (
    <li className="flex items-baseline justify-between gap-4 border-b border-dotted border-[var(--color-ink)]/15 pb-4">
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
          <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink-soft)]">
            {item.description}
          </p>
        )}
        {item.options && item.options.length > 0 && (
          <details className="group/opts mt-2">
            <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-wider text-[var(--color-brand-red)] hover:text-[var(--color-brand-red-bright)]">
              <span className="group-open/opts:hidden">+ Options &amp; toppings</span>
              <span className="hidden group-open/opts:inline">− Hide options</span>
            </summary>
            <div className="mt-3 space-y-3">
              {item.options.map((g) => (
                <div key={g.group}>
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-mute)]">
                    {g.group}
                    {g.rule && (
                      <span className="ml-1.5 font-medium normal-case tracking-normal text-[var(--color-ink)]/45">
                        · {g.rule}
                      </span>
                    )}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {g.choices.map((ch) => (
                      <span
                        key={ch.name}
                        className="inline-flex items-baseline gap-1 rounded-full bg-[var(--color-cream)] px-2.5 py-1 text-xs text-[var(--color-ink-soft)]"
                      >
                        {ch.name}
                        {ch.delta && (
                          <span className="font-semibold text-[var(--color-brand-red)]">{ch.delta}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
      {item.price ? (
        <span className="shrink-0 font-display text-xl text-[var(--color-brand-red)]">{item.price}</span>
      ) : (
        <span className="shrink-0 text-xs font-medium uppercase tracking-wider text-[var(--color-ink)]/50">
          Call to confirm
        </span>
      )}
    </li>
  );
}

export function Menu() {
  const [activeId, setActiveId] = useState<string>(MENU[0]?.id ?? "pizza");
  const [query, setQuery] = useState("");
  const active = MENU.find((c) => c.id === activeId) ?? MENU[0];
  const panelRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const searching = q.length >= 2;

  // Flattened cross-category matches on item name or category name.
  const results = useMemo(() => {
    if (!searching) return [];
    return MENU.flatMap((c) =>
      c.items
        .filter((it) => it.name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
        .map((it) => ({ item: it, category: c.name })),
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
          <h2 className="mt-3 text-4xl md:text-6xl">Made-to-order classics</h2>
          <p className="mt-4 text-base text-[var(--color-ink-soft)] md:text-lg">
            Pizzas, heroes, pasta dinners, wraps, salads, and Italian favorites.
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
                    {results.map(({ item, category }) => (
                      <MenuItemRow key={`${category}-${item.name}`} item={item} categoryLabel={category} />
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
                    <MenuItemRow key={item.name} item={item} />
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
          <a href={ORDER_ONLINE_URL} target="_blank" rel="noreferrer" className="btn-gold w-full sm:w-auto">
            Order Online
            <ArrowIcon className="h-4 w-4" />
          </a>
        </div>
        {MENU_VERIFIED && (
          <p className="mt-6 text-center text-xs text-[var(--color-ink)]/50">{PRICING_DISCLAIMER}</p>
        )}
      </div>
    </section>
  );
}
