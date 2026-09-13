import { LOCATION, DIRECTIONS_URL } from "../data/location";
import { HERO_IMAGE } from "../data/gallery";
import { PhoneIcon, PinIcon, ArrowIcon } from "./Icons";
import { OpenStatusPill } from "./OpenStatusPill";

export function Hero() {
  return (
    <section id="top" className="relative isolate overflow-hidden pt-20 md:pt-24">
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <picture>
          <source media="(min-width: 768px)" type="image/webp" srcSet={HERO_IMAGE.webpWide} sizes="100vw" />
          <source media="(min-width: 768px)" srcSet={HERO_IMAGE.srcWide} />
          <source type="image/webp" srcSet={HERO_IMAGE.webpPortrait} sizes="100vw" />
          <img src={HERO_IMAGE.srcPortrait} alt={HERO_IMAGE.alt} className="h-full w-full object-cover object-center" loading="eager" {...{ fetchpriority: "high" }} decoding="async" />
        </picture>
        <div className="absolute inset-0 bg-white/80 md:bg-white/50" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(255,255,255,.97) 0%, rgba(255,255,255,.9) 40%, rgba(255,255,255,.08) 100%)" }} />
      </div>
      <div className="container-x py-8 md:py-16">
        <div className="max-w-2xl text-[var(--color-copy)]">
          <p className="text-sm font-semibold text-[var(--color-action-text)]">{LOCATION.street} · Long Branch</p>
          <h1 className="mt-4 text-[2.6rem] leading-[1] sm:text-5xl lg:text-7xl">
            Real NY Style Pizza<br /><span className="text-[var(--color-action-text)]">in Long Branch.</span>
          </h1>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-[var(--color-copy)]/90">Your favorite pies, big slices, and Italian classics. Choose your meal for pickup or delivery.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="#menu" className="btn-gold w-full text-base sm:w-auto">Order Online<ArrowIcon className="h-5 w-5" /></a>
            <a href={`tel:${LOCATION.phoneTel}`} className="btn-outline flex-1 text-sm sm:flex-none" aria-label={`Call Gigi's Long Branch at ${LOCATION.phone}`}><PhoneIcon className="h-4 w-4" />Call the shop</a>
            <a href={DIRECTIONS_URL} target="_blank" rel="noreferrer" className="btn-outline flex-1 text-sm sm:flex-none"><PinIcon className="h-4 w-4" />Directions</a>
          </div>
          <div className="mt-5 max-w-xl text-xs leading-relaxed text-[var(--color-copy)]/85">
            <p className="mb-1 flex flex-wrap items-center gap-2"><span>Counter:</span><OpenStatusPill className="text-[var(--color-action-text)]" /></p>
            <p>Online pickup until 11 PM. Delivery until 10 PM. Counter open until 11 PM Mon–Wed / midnight Thu–Sun.</p>
          </div>
          <p className="mt-5 text-sm"><a href="/account/?join=1" className="font-semibold text-[var(--color-action-text)] underline underline-offset-4">Join VIP: free pizza pie + exclusive deals →</a></p>
          <p className="mt-5 text-xs text-[var(--color-copy)]/80">Looking for our other shop? <a href="https://gigisnystylepizza.com/sea-bright" className="font-semibold text-[var(--color-copy)] underline underline-offset-4">Visit Sea Bright →</a></p>
        </div>
      </div>
    </section>
  );
}
