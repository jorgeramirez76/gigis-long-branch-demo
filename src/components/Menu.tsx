import { useEffect, useRef, useState } from "react";
import { MENU, PRICING_DISCLAIMER, MENU_VERIFIED } from "../data/menu";
import { LOCATION, ORDER_ONLINE_URL } from "../data/location";
import { ArrowIcon, PhoneIcon } from "./Icons";

export function Menu() {
  const [activeId, setActiveId] = useState<string>(MENU[0]?.id ?? "pizza");
  const active = MENU.find((c) => c.id === activeId) ?? MENU[0];
  const panelRef = useRef<HTMLDivElement>(null);

  // Small fade transition when category changes
  const [fadeKey, setFadeKey] = useState(0);
  useEffect(() => {
    setFadeKey((k) => k + 1);
  }, [activeId]);

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

        {/* Category tabs */}
        <div
          className="scrollbar-none relative mt-10 -mx-5 flex w-[calc(100%+2.5rem)] min-w-0 max-w-[calc(100%+2.5rem)] gap-2 overflow-x-auto px-5 pb-2 md:mx-0 md:w-auto md:min-w-0 md:max-w-none md:flex-wrap md:justify-center md:overflow-visible md:px-0"
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

        {/* Active panel */}
        <div
          ref={panelRef}
          className="mt-10 rounded-3xl bg-white p-6 shadow-[var(--shadow-lg)] md:p-10"
          data-reveal
        >
          <div
            key={fadeKey}
            className="hero-in"
            style={{ animationDuration: "0.4s" }}
          >
            <div className="mb-8 border-b border-[var(--color-ink)]/8 pb-6">
              <h3 className="font-display text-3xl md:text-4xl">{active.name}</h3>
              {active.blurb && (
                <p className="mt-2 text-sm text-[var(--color-ink-soft)] md:text-base">
                  {active.blurb}
                </p>
              )}
            </div>

            <ul className="grid gap-x-10 gap-y-5 md:grid-cols-2">
              {active.items.map((item) => (
                <li
                  key={item.name}
                  className="flex items-baseline justify-between gap-4 border-b border-dotted border-[var(--color-ink)]/15 pb-4"
                >
                  <div className="min-w-0 flex-1">
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
                  </div>
                  {item.price ? (
                    <span className="shrink-0 font-display text-xl text-[var(--color-brand-red)]">
                      {item.price}
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs font-medium uppercase tracking-wider text-[var(--color-ink)]/50">
                      Call to confirm
                    </span>
                  )}
                </li>
              ))}
            </ul>
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
          <p className="mt-6 text-center text-xs text-[var(--color-ink)]/50">
            {PRICING_DISCLAIMER}
          </p>
        )}
      </div>
    </section>
  );
}
