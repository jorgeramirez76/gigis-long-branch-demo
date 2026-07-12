import { LOCATION, DIRECTIONS_URL, ORDER_ONLINE_URL } from "../data/location";
import { HOURS_ONE_LINE } from "../data/hours";
import { HERO_IMAGE } from "../data/gallery";
import { PhoneIcon, MenuIcon, PinIcon, ArrowIcon, StarIcon } from "./Icons";

export function Hero() {
  return (
    <section
      id="top"
      className="relative isolate flex min-h-[100svh] flex-col overflow-hidden pt-20 md:pt-28"
    >
      {/* Background — portrait on mobile, wide on md+; slow Ken-Burns for life */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <picture>
          <source media="(min-width: 768px)" srcSet={HERO_IMAGE.srcWide} />
          <img
            src={HERO_IMAGE.srcPortrait}
            alt={HERO_IMAGE.alt}
            className="ken-burns h-full w-full object-cover object-center"
            loading="eager"
            decoding="async"
          />
        </picture>
        {/* Strong bottom overlay so text stays legible over busy food background */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(10,6,5,0.55) 0%, rgba(10,6,5,0.65) 40%, rgba(10,6,5,0.92) 95%)",
          }}
        />
        {/* Left-side darken on desktop so pizza stays visible on the right */}
        <div
          aria-hidden="true"
          className="absolute inset-0 hidden md:block"
          style={{
            background:
              "linear-gradient(90deg, rgba(10,6,5,0.88) 0%, rgba(10,6,5,0.55) 42%, rgba(10,6,5,0) 72%)",
          }}
        />
      </div>

      {/* Content */}
      <div className="container-x flex flex-1 flex-col justify-end pb-14 pt-8 md:justify-center md:pb-24 md:pt-24">
        <div className="max-w-3xl text-cream">
          <span className="hero-in hero-in-1 inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--color-gold-bright)]/60 bg-black/40 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-gold-bright)] backdrop-blur sm:tracking-[0.22em] md:text-xs">
            <StarIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate sm:whitespace-normal">Voted one of the top pizzas in NJ</span>
          </span>

          <h1 className="hero-in hero-in-2 mt-5 text-[2.6rem] leading-[0.95] text-white sm:text-[3.25rem] md:text-[4.25rem] lg:text-[5.5rem] xl:text-[6.5rem]">
            Real NY Style Pizza
            <br />
            <span className="text-[var(--color-gold-bright)]">in Long Branch.</span>
          </h1>

          <p className="hero-in hero-in-3 mt-5 max-w-xl text-base leading-relaxed text-cream/90 md:text-lg">
            Fresh dough, big slices, loaded specialty pies, classic Italian
            favorites — the kind of neighborhood pizza shop people come back to.
          </p>

          {/* Hours + address strip */}
          <div className="hero-in hero-in-4 mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-cream/85 md:text-sm">
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-gold-bright)] shadow-[0_0_10px_rgba(230,180,94,0.9)]" />
              {HOURS_ONE_LINE}
            </span>
            <span className="hidden h-1 w-1 rounded-full bg-white/25 md:inline-block" />
            <span className="text-[var(--color-gold-bright)]">{LOCATION.street}, Long Branch</span>
          </div>

          <div className="hero-in hero-in-5 mt-7 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
            <a
              href={`tel:${LOCATION.phoneTel}`}
              className="btn-primary w-full text-base sm:w-auto"
              aria-label={`Call Gigi's Long Branch at ${LOCATION.phone}`}
            >
              <PhoneIcon className="h-5 w-5" />
              Call {LOCATION.phone}
            </a>
            <a
              href={ORDER_ONLINE_URL}
              target="_blank"
              rel="noreferrer"
              className="btn-gold w-full text-base sm:w-auto"
            >
              Order Online
              <ArrowIcon className="h-5 w-5" />
            </a>
            <div className="flex gap-2.5">
              <a href="#menu" className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-white px-5 py-3.5 text-sm font-bold uppercase tracking-wide text-[var(--color-ink)] transition hover:bg-[var(--color-cream)] active:scale-[0.97] sm:flex-initial">
                <MenuIcon className="h-4 w-4" />
                Menu
              </a>
              <a href={DIRECTIONS_URL} target="_blank" rel="noreferrer" className="btn-outline flex-1 px-5 py-3.5 text-sm sm:flex-initial">
                <PinIcon className="h-4 w-4" />
                Directions
              </a>
            </div>
          </div>

          {/* Soft urgency line — no fake claims */}
          <p className="hero-in hero-in-5 mt-5 text-xs text-cream/70 md:text-[13px]">
            Tip: <span className="text-cream/90">call ahead for pickup</span> — pies come out fast at the counter.
          </p>
        </div>
      </div>

      {/* Cream bleed into next section */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-[var(--color-cream)] md:h-24"
      />
    </section>
  );
}
