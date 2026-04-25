import { ACCOLADE, RATING_SNAPSHOT, REVIEW_THEMES } from "../data/reviews";
import { StarIcon } from "./Icons";

export function Reviews() {
  return (
    <section id="reviews" className="scroll-mt-20 py-20 md:py-28">
      <div className="container-x">
        <div className="mx-auto max-w-2xl text-center" data-reveal>
          <div className="flex items-center justify-center gap-1 text-[var(--color-gold)]">
            {Array.from({ length: 5 }).map((_, i) => (
              <StarIcon key={i} className="h-6 w-6" />
            ))}
          </div>
          <span className="eyebrow mt-4 block">What locals say</span>
          <h2 className="mt-3 text-4xl md:text-5xl">The neighborhood take</h2>
          <p className="mt-4 text-base text-[var(--color-ink-soft)] md:text-lg">
            {ACCOLADE.label}. Themes below paraphrased from publicly visible reviews on Google, Slice, Uber Eats, and Restaurantji.
          </p>
        </div>

        {/* Rating tiles */}
        <div className="mx-auto mt-10 grid max-w-3xl grid-cols-3 gap-3 text-center" data-reveal>
          <RatingTile score={RATING_SNAPSHOT.slice.score} count={`${RATING_SNAPSHOT.slice.count} reviews`} label="on Slice" href={RATING_SNAPSHOT.slice.url} />
          <RatingTile score={RATING_SNAPSHOT.uberEats.score} count={`${RATING_SNAPSHOT.uberEats.countLabel} ratings`} label="on Uber Eats" href={RATING_SNAPSHOT.uberEats.url} />
          <RatingTile score={RATING_SNAPSHOT.restaurantji.score} count={`${RATING_SNAPSHOT.restaurantji.count} reviews`} label="on Restaurantji" href={RATING_SNAPSHOT.restaurantji.url} />
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {REVIEW_THEMES.map((t, i) => (
            <article
              key={t.heading}
              data-reveal
              style={{ ["--delay" as string]: `${(i % 4) * 70}ms` }}
              className="group relative overflow-hidden rounded-2xl border border-[var(--color-ink)]/10 bg-white p-6 shadow-[var(--shadow-sm)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-lg)]"
            >
              <div aria-hidden="true" className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-[var(--color-brand-red)]/5 transition group-hover:bg-[var(--color-brand-red)]/10" />
              <div className="relative">
                <div className="flex gap-0.5 text-[var(--color-gold)]">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <StarIcon key={i} className="h-3.5 w-3.5" />
                  ))}
                </div>
                <h3 className="mt-4 font-display text-2xl text-[var(--color-ink)]">
                  {t.heading}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                  {t.body}
                </p>
              </div>
            </article>
          ))}
        </div>

        <p className="mt-10 text-center text-xs text-[var(--color-ink)]/40">
          Ratings pulled 2026-04-24. Themes paraphrased from publicly visible reviews; individual reviews belong to their authors.
        </p>
      </div>
    </section>
  );
}

function RatingTile({ score, count, label, href }: { score: number; count: string; label: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group rounded-2xl border border-[var(--color-ink)]/10 bg-white p-3 shadow-[var(--shadow-sm)] transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--color-brand-red)]/40 hover:shadow-[var(--shadow-md)] md:p-4"
    >
      <p className="font-display text-3xl text-[var(--color-brand-red)] md:text-4xl">
        {score.toFixed(1)}
        <span className="text-lg text-[var(--color-ink)]/40 md:text-xl">/5</span>
      </p>
      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-soft)]">
        {label}
      </p>
      <p className="text-[10px] text-[var(--color-ink)]/50">{count}</p>
    </a>
  );
}
