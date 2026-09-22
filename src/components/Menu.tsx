import { CategoryRail } from "./CategoryRail";
import { useMenu } from "../hooks/useMenu";
import { useEffect, useMemo, useRef, useState } from "react";
import { MENU, PRICING_DISCLAIMER } from "../data/menu";
import type { MenuItem } from "../data/menu";
import { LOCATION } from "../data/location";
import { PhoneIcon } from "./Icons";
import { useOrderingUI } from "../ordering/OrderingProvider";
import { useCart } from "../ordering/CartContext";
import { goToMenu } from "../lib/goToMenu";
import { menuPhotos } from "../data/menuPhotos";

/** One orderable menu line. The whole row opens the item modal (options +
 * quantity → add to cart). `categoryLabel` is shown only in search results. */
function MenuItemRow({ item, categoryId, categoryLabel }: { item: MenuItem; categoryId: string; categoryLabel?: string }) {
  const { configureItem, isOrderable } = useOrderingUI();
  const orderable = isOrderable(item);
  const hasOptions = !!item.options && item.options.length > 0;
  const photo = menuPhotos(categoryId, item.name)[0];

  const text = (
    <div className="min-w-0 flex-1">
      {categoryLabel && (
        <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-copy-muted)]">
          {categoryLabel}
        </p>
      )}
      <p className="font-serif text-[17px] font-semibold text-[var(--color-copy)] md:text-lg">
        {item.name}
        {item.popular && (
          <span className="ml-2 inline-flex items-center rounded-full bg-[var(--color-brand-red)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-action-text)]">
            Popular
          </span>
        )}
      </p>
      {item.description && (
        <p className="mt-1 text-sm leading-relaxed text-[var(--color-copy-soft)]">{item.description}</p>
      )}
      {hasOptions && orderable && (
        <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-copy-muted)]">
          Toppings &amp; options
        </p>
      )}
    </div>
  );

  const info = photo ? (
    <div className="flex min-w-0 flex-1 items-center gap-3 md:gap-4">
      <img
        src={photo.thumb}
        alt={photo.caption}
        width={320}
        height={240}
        loading="lazy"
        decoding="async"
        className="h-20 w-20 shrink-0 rounded-xl object-cover shadow-[var(--shadow-sm)] md:h-24 md:w-24"
      />
      {text}
    </div>
  ) : text;

  if (!orderable) {
    return (
      <li className="flex items-baseline justify-between gap-4 border-b border-dotted border-[var(--color-line)] pb-4">
        {info}
        <span className="shrink-0 text-xs font-medium uppercase tracking-wider text-[var(--color-copy-muted)]">
          Call to confirm
        </span>
      </li>
    );
  }

  return (
    <li className="border-b border-dotted border-[var(--color-line)]">
      <button
        type="button"
        onClick={() => configureItem(item, categoryId)}
        className="group/item flex w-full items-center justify-between gap-4 rounded-lg pb-4 text-left transition"
      >
        {info}
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="font-display text-xl text-[var(--color-copy)]">{item.price}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-brand-red)] px-3.5 py-1 text-xs font-bold uppercase tracking-wide text-white shadow-[var(--shadow-red)] transition group-hover/item:bg-[var(--color-brand-red-bright)]">
            Add +
          </span>
        </span>
      </button>
    </li>
  );
}

export function Menu() {
  const menu = useMenu();

  const [activeId, setActiveId] = useState<string>(MENU[0]?.id ?? "pizza");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const category = new URLSearchParams(window.location.search).get("category");
    if (category && menu.some(c => c.id === category)) setActiveId(category);
  }, [menu]);

  const active = menu.find((c) => c.id === activeId) ?? menu[0];
  const panelRef = useRef<HTMLDivElement>(null);
  const cart = useCart();

  function chooseCategory(id: string) {
    if (!menu.some(category => category.id === id)) return;
    setActiveId(id);
    setQuery("");
    const url = new URL(window.location.href);
    url.searchParams.set("category", id);
    url.hash = "menu";
    window.history.replaceState(null, "", url);
  }


  const q = query.trim().toLowerCase();
  const searching = q.length >= 2;

  // Flattened cross-category matches on item name or category name.
  const results = useMemo(() => {
    if (!searching) return [];
    return menu.flatMap((c) =>
      c.items
        .filter((it) => it.name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
        .map((it) => ({ item: it, category: c.name, categoryId: c.id })),
    );
  }, [q, searching, menu]);

  // Small fade transition when the view changes.
  const [fadeKey, setFadeKey] = useState(0);
  useEffect(() => {
    setFadeKey((k) => k + 1);
  }, [activeId, searching]);

  return (
    <section
      id="menu"
      className="scroll-mt-20 overflow-hidden bg-[var(--color-page)] py-8 md:scroll-mt-28 md:py-16"
    >
      <div className="container-x">
        <h2 className="text-center text-3xl md:text-4xl">Explore the menu</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-xs leading-relaxed text-[var(--color-copy-muted)] md:text-sm">
          Prices shown are our cash prices. Online orders are paid by card, so 4% card
          pricing is added at checkout.
        </p>

        {/* Search */}
        <div className="mx-auto mt-4 max-w-md" data-reveal>
          <div className="relative">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the menu — “grandma”, “buffalo”, “parm”…"
              aria-label="Search the menu"
              className="w-full rounded-full border border-[var(--color-line)] bg-[var(--color-panel)] py-3 pl-11 pr-4 text-sm shadow-[var(--shadow-sm)] focus:border-[var(--color-brand-red)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-red)]/20"
            />
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-copy-muted)]"
            >
              <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="2" />
              <path d="m14 14 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        <CategoryRail categories={menu} activeId={searching ? "" : active.id} onSelect={chooseCategory} />

        {/* Panel */}
        <div
          ref={panelRef}
          className="mt-5 rounded-2xl bg-[var(--color-panel)] p-4 shadow-[var(--shadow-lg)] md:mt-6 md:p-8"
          data-reveal
        >
          <div key={fadeKey} className="hero-in" style={{ animationDuration: "0.4s" }}>
            {searching ? (
              <>
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--color-line)] pb-3">
                  <h3 className="font-display text-3xl md:text-4xl">
                    {results.length} {results.length === 1 ? "result" : "results"}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="text-sm font-semibold text-[var(--color-action-text)] underline"
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
                  <p className="py-6 text-center text-[var(--color-copy-soft)]">
                    Nothing matches “{query.trim()}”. Try another word, browse the categories, or call{" "}
                    {LOCATION.phone}.
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="mb-4 border-b border-[var(--color-line)] pb-3">
                  <h3 className="font-display text-3xl md:text-4xl">{active.name}</h3>
                  {active.blurb && (
                    <p className="mt-2 text-sm text-[var(--color-copy-soft)] md:text-base">{active.blurb}</p>
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

        </div>

        <details className="mt-5 rounded-xl border border-[var(--color-line)] px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold text-[var(--color-copy-soft)]">Menu guides &amp; more information</summary>
          <nav aria-label="Menu guides" className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-[var(--color-action-text)]">
            <a href="/menu/" className="py-2 underline underline-offset-4">Full menu &amp; prices</a>
            <a href="/gluten-free-pizza-long-branch/" className="py-2 underline underline-offset-4">Gluten-free pizza options</a>
            <a href="/vegan-pizza-long-branch/" className="py-2 underline underline-offset-4">Vegan pizza options</a>
            <a href="/delivery/" className="py-2 underline underline-offset-4">Delivery information</a>
          </nav>
        </details>

        {/* CTA row below the menu */}
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row" data-reveal>
          <a href={`tel:${LOCATION.phoneTel}`} className="btn-primary w-full sm:w-auto">
            <PhoneIcon className="h-4 w-4" />
            Call ahead for pickup · {LOCATION.phone}
          </a>
          <button
            type="button"
            onClick={cart.count > 0 ? cart.openCart : goToMenu}
            className="btn-gold w-full sm:w-auto"
          >
            {cart.count > 0 ? `View your order · ${cart.count}` : "Start your order"}
          </button>
        </div>
        <p className="mt-6 text-center text-xs text-[var(--color-copy-muted)]">{PRICING_DISCLAIMER}</p>
      </div>
    </section>
  );
}
