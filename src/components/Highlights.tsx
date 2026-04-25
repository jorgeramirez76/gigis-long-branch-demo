import { MENU } from "../data/menu";
import { LOCATION, ORDER_ONLINE_URL } from "../data/location";
import { ArrowIcon, PhoneIcon } from "./Icons";

export function Highlights() {
  const highlights = MENU.flatMap((c) =>
    c.items.filter((i) => i.popular).map((i) => ({ ...i, category: c.name })),
  ).slice(0, 6);

  if (highlights.length === 0) return null;

  return (
    <section aria-label="Signature menu highlights" className="py-16 md:py-24">
      <div className="container-x">
        <div className="mx-auto max-w-2xl text-center" data-reveal>
          <span className="eyebrow">Signature picks</span>
          <h2 className="mt-3 text-4xl md:text-5xl">What people order</h2>
          <p className="mt-4 text-base text-[var(--color-ink-soft)] md:text-lg">
            Called out by regulars in public reviews. Then browse the full menu below.
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {highlights.map((h, i) => (
            <article
              key={h.name}
              data-reveal
              style={{ ["--delay" as string]: `${(i % 3) * 80}ms` }}
              className="group relative overflow-hidden rounded-2xl border border-[var(--color-ink)]/5 bg-white p-6 shadow-[var(--shadow-sm)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-lg)]"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-2xl text-[var(--color-ink)]">
                  {h.name}
                </h3>
                {h.price && (
                  <span className="font-display text-xl text-[var(--color-brand-red)]">
                    {h.price}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-brand-red)]">
                {h.category}
              </p>
              {h.description && (
                <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                  {h.description}
                </p>
              )}
              <a
                href="#menu"
                className="mt-5 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-[var(--color-brand-red)] transition group-hover:gap-2.5"
              >
                See full menu <span aria-hidden="true">→</span>
              </a>
            </article>
          ))}
        </div>

        {/* CTA row */}
        <div className="mt-12 flex flex-col items-center justify-center gap-3 sm:flex-row" data-reveal>
          <a href={`tel:${LOCATION.phoneTel}`} className="btn-primary w-full sm:w-auto">
            <PhoneIcon className="h-4 w-4" />
            Call {LOCATION.phone}
          </a>
          <a href={ORDER_ONLINE_URL} target="_blank" rel="noreferrer" className="btn-gold w-full sm:w-auto">
            Order Online
            <ArrowIcon className="h-4 w-4" />
          </a>
        </div>
      </div>
    </section>
  );
}
