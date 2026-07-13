import { FAVORITES } from "../data/gallery";

/** Signature pies with real photos — the conversion bridge between the
 * gallery vibe and the (very long) full menu. */
export function FanFavorites() {
  return (
    <section
      id="fan-favorites"
      aria-label="Fan favorite pies"
      className="scroll-mt-20 bg-[var(--color-cream-dark)] py-14 md:py-24"
    >
      <div className="container-x">
        <div className="mb-8 flex items-end justify-between gap-6 md:mb-10" data-reveal>
          <div>
            <span className="eyebrow">Ask anyone in Long Branch</span>
            <h2 className="mt-3 text-4xl md:text-5xl">Fan favorites</h2>
          </div>
          <p className="hidden max-w-sm text-right text-sm text-[var(--color-ink-soft)] md:block">
            The pies people drive down Brighton Ave for — photographed exactly as they
            come out of the oven.
          </p>
        </div>

        <div className="mx-auto grid max-w-3xl gap-5 sm:grid-cols-2">
          {FAVORITES.map((f, i) => (
            <article
              key={f.name}
              data-reveal
              style={{ ["--delay" as string]: `${(i % 4) * 70}ms` }}
              className="group overflow-hidden rounded-2xl bg-white shadow-[var(--shadow-md)] transition-shadow duration-300 hover:shadow-[var(--shadow-lg)]"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-[var(--color-char)]">
                <img
                  src={f.src}
                  alt={f.alt}
                  loading="lazy"
                  decoding="async"
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                  className="h-full w-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.06]"
                />
              </div>
              <div className="p-4 md:p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-display text-2xl leading-none">{f.name}</h3>
                  <span className="shrink-0 font-bold text-[var(--color-brand-red)]">{f.price}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">{f.blurb}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3" data-reveal>
          <a
            href="#menu"
            className="rounded-full bg-[var(--color-brand-red)] px-7 py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-[var(--shadow-red)] transition hover:bg-[var(--color-brand-red-bright)]"
          >
            Order one now
          </a>
          <a
            href="#menu"
            className="rounded-full border-2 border-[var(--color-ink)]/15 px-7 py-3.5 text-sm font-bold uppercase tracking-wide text-[var(--color-ink)] transition hover:border-[var(--color-ink)]/40"
          >
            See the full menu
          </a>
        </div>
      </div>
    </section>
  );
}
