/** All-day breakfast highlight — a dine-in daypart with its own full menu page
 * at /breakfast. Photos are the owner's poster shots, cropped per dish. */
const ITEMS = [
  {
    src: "/img/breakfast-skillet.jpg",
    name: "The Gigi Skillet",
    price: "$9.83",
    blurb: "Tater-tots smothered in our homemade cheese sauce with bacon, sausage, or pork roll.",
  },
  {
    src: "/img/breakfast-omelette.jpg",
    name: "Loaded Omelettes",
    price: "from $11.43",
    blurb: "Fluffy omelettes with Gigi's famous home-fries & toast — Veggie, Western, B-Fit & more.",
  },
  {
    src: "/img/breakfast-burrito.jpg",
    name: "Toasty-Tasty Burritos",
    price: "from $10.39",
    blurb: "Scrambled eggs, crispy tater tots & melted cheese wrapped in a huge tortilla.",
  },
  {
    src: "/img/breakfast-sandwich.jpg",
    name: "Egg Sandwiches",
    price: "from $4.16",
    blurb: "Egg & cheese your way on a Kaiser roll, bagel, or wrap. Add pork roll, bacon, or sausage.",
  },
];

export function Breakfast() {
  return (
    <section
      id="breakfast"
      aria-label="All-day breakfast"
      className="scroll-mt-20 bg-[var(--color-cream)] py-14 md:py-24"
    >
      <div className="container-x">
        <div className="mb-8 flex items-end justify-between gap-6 md:mb-10" data-reveal>
          <div>
            <span className="eyebrow">Served all day &middot; dine-in</span>
            <h2 className="mt-3 text-4xl md:text-5xl">Gigi's Breakfast</h2>
          </div>
          <p className="hidden max-w-sm text-right text-sm text-[var(--color-ink-soft)] md:block">
            Pancakes, skillets, omelettes &amp; breakfast pizza — cooked to order all day long at
            140 Brighton Ave.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map((f, i) => (
            <article
              key={f.name}
              data-reveal
              style={{ ["--delay" as string]: `${(i % 4) * 70}ms` }}
              className="group overflow-hidden rounded-2xl bg-white shadow-[var(--shadow-md)] transition-shadow duration-300 hover:shadow-[var(--shadow-lg)]"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-[var(--color-char)]">
                <img
                  src={f.src}
                  alt={`${f.name} at Gigi's Long Branch`}
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

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-3" data-reveal>
          <a
            href="/breakfast"
            className="rounded-full bg-[var(--color-brand-red)] px-7 py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-[var(--shadow-red)] transition hover:bg-[var(--color-brand-red-bright)]"
          >
            View the full breakfast menu
          </a>
          <span className="text-sm text-[var(--color-ink-soft)]">
            Or scan the QR at your table to browse.
          </span>
        </div>
      </div>
    </section>
  );
}
