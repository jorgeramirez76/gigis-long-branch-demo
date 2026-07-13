import { BRAND_INSIDE } from "../data/gallery";
import { LOCATION } from "../data/location";
import { MENU } from "../data/menu";
import { PhoneIcon, StarIcon } from "./Icons";

export function About() {
  return (
    <section
      id="about"
      className="relative overflow-hidden bg-[var(--color-ink)] py-20 text-cream md:py-28"
    >
      {/* Dining room as darkened background */}
      <div className="absolute inset-0 -z-10">
        <img
          src={BRAND_INSIDE.wide}
          alt=""
          role="presentation"
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(26,18,16,0.88) 0%, rgba(26,18,16,0.94) 50%, rgba(26,18,16,0.97) 100%)",
          }}
        />
      </div>

      <div className="container-x relative">
        <div className="grid items-center gap-10 md:grid-cols-[1.15fr_1fr] md:gap-16">
          <div>
            <span className="eyebrow text-[var(--color-gold-bright)]" data-reveal>
              About the shop
            </span>
            <h2 className="mt-3 text-4xl text-white md:text-6xl" data-reveal style={{ ["--delay" as string]: "80ms" }}>
              Neighborhood pizza on{" "}
              <span className="text-[var(--color-gold-bright)]">Brighton Ave.</span>
            </h2>

            <div className="mt-8 space-y-5 text-lg leading-relaxed text-cream/90" data-reveal style={{ ["--delay" as string]: "160ms" }}>
              <p>
                Gigi's NY Style Pizza &amp; Restaurant is a family-run pizzeria at
                140 Brighton Avenue in the West End of Long Branch. We make real New
                York-style pizza — hand-stretched dough, house tomato sauce, real
                mozzarella — sold as whole pies and by the slice.
              </p>
              <p>
                Alongside our round pies we serve Grandma and Sicilian squares,
                stuffed and specialty pizzas, heroes, pasta, and Italian dinners
                — plus gluten-free and vegan pizza. A full neighborhood kitchen,
                open year-round, not just a summer slice stop.
              </p>
            </div>

            {/* Recognition callout — real, verified rating (no unverified award claims) */}
            <div
              className="mt-8 inline-flex items-center gap-3 rounded-xl border border-[var(--color-gold-bright)]/30 bg-black/40 px-5 py-4 backdrop-blur"
              data-reveal="scale"
              style={{ ["--delay" as string]: "220ms" }}
            >
              <StarIcon className="h-6 w-6 shrink-0 text-[var(--color-gold-bright)]" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-gold-bright)]">
                  Loved locally
                </p>
                <p className="font-display text-xl text-white md:text-2xl">
                  Rated 4.6 out of 5 on Restaurantji
                </p>
              </div>
            </div>

            {/* Secondary call CTA inside About */}
            <a
              href={`tel:${LOCATION.phoneTel}`}
              className="btn-primary mt-8 inline-flex"
              data-reveal
              style={{ ["--delay" as string]: "280ms" }}
            >
              <PhoneIcon className="h-4 w-4" />
              Call Long Branch · {LOCATION.phone}
            </a>

            <dl className="mt-10 grid grid-cols-3 gap-5 border-t border-white/10 pt-8" data-reveal>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-gold-bright)]">
                  Style
                </dt>
                <dd className="mt-2 font-display text-2xl text-white md:text-3xl">
                  NY Slice
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-gold-bright)]">
                  Menu
                </dt>
                <dd className="mt-2 font-display text-2xl text-white md:text-3xl">
                  {MENU.length} cats.
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-gold-bright)]">
                  Where
                </dt>
                <dd className="mt-2 font-display text-2xl text-white md:text-3xl">
                  Long Branch
                </dd>
              </div>
            </dl>
          </div>

          {/* Signature medallion */}
          <div className="relative flex justify-center md:justify-end" data-reveal="right" style={{ ["--delay" as string]: "200ms" }}>
            <div className="relative aspect-square w-full max-w-md">
              <div className="absolute inset-0 rounded-full bg-[var(--color-brand-red)]/25 blur-3xl" aria-hidden="true" />
              <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border-2 border-[var(--color-gold-bright)]/20 bg-white/5 p-3 backdrop-blur-sm">
                <img
                  src={BRAND_INSIDE.tile}
                  alt="Gigi's Long Branch dining room"
                  className="h-full w-full rounded-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
                {/* Italian tricolor accent — inside the medallion, no overflow risk */}
                <div aria-hidden="true" className="absolute right-4 top-6 hidden h-14 w-2 rounded-full md:block" style={{
                  background: "linear-gradient(180deg, var(--color-italy-green) 0 33%, var(--color-italy-white) 33% 66%, var(--color-italy-red) 66% 100%)",
                }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
