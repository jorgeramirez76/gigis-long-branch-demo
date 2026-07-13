import { ORDER_ONLINE_URL } from "../data/location";
import { ArrowIcon } from "./Icons";

/**
 * Pre-checkout upsell nudge. Real Clover ordering happens on the hosted Clover
 * page, whose checkout UI we can't modify — so this plants the "don't forget the
 * extras" idea on our own site, right before the handoff. Prices mirror the
 * live Clover menu (src/data/menuGenerated.ts); keep them in sync.
 */
const ADD_ONS = [
  {
    name: "Garlic Knots",
    price: "$6.24",
    blurb: "Fresh-baked and brushed with garlic butter. The side no pizza order should skip.",
  },
  {
    name: "Gigi's Wings (12)",
    price: "$15.60",
    blurb: "Tossed in your sauce of choice — buffalo, BBQ, honey sriracha, and more.",
  },
  {
    name: "Cannoli (2)",
    price: "$6.23",
    blurb: "The classic Italian finish. Add a pair to round out the table.",
  },
];

export function AddOns() {
  return (
    <section
      id="add-ons"
      aria-label="Popular add-ons"
      className="scroll-mt-20 bg-[var(--color-cream-dark)] py-14 md:py-20"
    >
      <div className="container-x">
        <div className="mx-auto max-w-2xl text-center" data-reveal>
          <span className="eyebrow">Round out your order</span>
          <h2 className="mt-3 text-3xl md:text-5xl">Don't forget the extras</h2>
          <p className="mt-3 text-base text-[var(--color-ink-soft)] md:text-lg">
            The add-ons people wish they'd ordered — tack them on before you check out.
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-3 md:gap-5">
          {ADD_ONS.map((item, i) => (
            <a
              key={item.name}
              href={ORDER_ONLINE_URL}
              target="_blank"
              rel="noopener"
              data-reveal
              style={{ ["--delay" as string]: `${(i % 3) * 70}ms` }}
              className="group flex flex-col rounded-2xl bg-white p-5 text-left shadow-[var(--shadow-sm)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-lg)] md:p-6"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-2xl leading-none text-[var(--color-ink)]">
                  {item.name}
                </h3>
                <span className="shrink-0 font-bold text-[var(--color-brand-red)]">
                  {item.price}
                </span>
              </div>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {item.blurb}
              </p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-brand-red)] transition group-hover:gap-2.5">
                Add to your order <ArrowIcon className="h-4 w-4" />
              </span>
            </a>
          ))}
        </div>

        <div className="mt-8 text-center" data-reveal>
          <a
            href={ORDER_ONLINE_URL}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-2 rounded-full bg-[var(--color-brand-red)] px-7 py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-[var(--shadow-red)] transition hover:bg-[var(--color-brand-red-bright)]"
          >
            Order online
            <ArrowIcon className="h-4 w-4" />
          </a>
        </div>
      </div>
    </section>
  );
}
