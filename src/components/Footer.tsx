import { ADDRESS_ONE_LINE, DIRECTIONS_URL, LOCATION, SOCIALS } from "../data/location";
import { HOURS_ONE_LINE } from "../data/hours";
import logoPng from "../assets/brand/logo.png";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="relative bg-[var(--color-char)] pb-12 pt-14 text-cream md:pt-16">
      {/* Italian tricolor — 3px accent stripe at very top */}
      <div className="absolute inset-x-0 top-0 tricolor opacity-90" aria-hidden="true" />

      <div className="container-x">
        <div className="grid gap-10 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <div>
            <img src={logoPng} alt="Gigi's NY Style Pizza & Restaurant logo" className="h-14 w-auto" width={70} height={76} />
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-cream/75">
              Real NY-style pizza, specialty pies, heroes, pasta, and Italian
              classics — served on Brighton Ave in Long Branch.
            </p>
            <div className="mt-5 flex gap-2">
              <a
                href={SOCIALS.instagram}
                target="_blank"
                rel="noreferrer"
                aria-label="Instagram"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 transition hover:border-[var(--color-gold-bright)] hover:bg-white/5 hover:text-[var(--color-gold-bright)]"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                  <path d="M12 2c2.7 0 3.05.01 4.12.06 1.06.05 1.79.22 2.43.47a4.9 4.9 0 0 1 1.77 1.15 4.9 4.9 0 0 1 1.15 1.77c.25.64.42 1.37.47 2.43.05 1.07.06 1.42.06 4.12s-.01 3.05-.06 4.12c-.05 1.06-.22 1.79-.47 2.43a4.9 4.9 0 0 1-1.15 1.77 4.9 4.9 0 0 1-1.77 1.15c-.64.25-1.37.42-2.43.47-1.07.05-1.42.06-4.12.06s-3.05-.01-4.12-.06c-1.06-.05-1.79-.22-2.43-.47a4.9 4.9 0 0 1-1.77-1.15 4.9 4.9 0 0 1-1.15-1.77c-.25-.64-.42-1.37-.47-2.43C2.01 15.05 2 14.7 2 12s.01-3.05.06-4.12c.05-1.06.22-1.79.47-2.43A4.9 4.9 0 0 1 3.68 3.68a4.9 4.9 0 0 1 1.77-1.15c.64-.25 1.37-.42 2.43-.47C8.95 2.01 9.3 2 12 2zm0 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm5.5-3a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z" />
                </svg>
              </a>
              <a
                href={SOCIALS.facebook}
                target="_blank"
                rel="noreferrer"
                aria-label="Facebook"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 transition hover:border-[var(--color-gold-bright)] hover:bg-white/5 hover:text-[var(--color-gold-bright)]"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                  <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H8v-2.89h2.44V9.8c0-2.4 1.43-3.73 3.62-3.73 1.05 0 2.14.19 2.14.19v2.36h-1.2c-1.19 0-1.56.74-1.56 1.5v1.8h2.65l-.42 2.89h-2.23v6.99A10 10 0 0 0 22 12z" />
                </svg>
              </a>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--color-gold-bright)]">
              Long Branch
            </p>
            <address className="mt-3 not-italic text-sm leading-relaxed text-cream/85">
              {ADDRESS_ONE_LINE}
              <br />
              <a href={`tel:${LOCATION.phoneTel}`} className="text-white hover:text-[var(--color-gold-bright)]">
                {LOCATION.phone}
              </a>
            </address>
            <a href={DIRECTIONS_URL} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-[var(--color-gold-bright)] hover:underline">
              Get directions →
            </a>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--color-gold-bright)]">
              Hours
            </p>
            <p className="mt-3 text-sm text-cream/85">{HOURS_ONE_LINE}</p>
            <a href="#menu" className="mt-3 inline-block text-sm font-semibold text-[var(--color-gold-bright)] hover:underline">
              Order online →
            </a>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--color-gold-bright)]">
              Jump to
            </p>
            <ul className="mt-3 space-y-2 text-sm text-cream/85">
              <li><a href="#menu" className="hover:text-white">Menu</a></li>
              <li><a href="#about" className="hover:text-white">About</a></li>
              <li><a href="#reviews" className="hover:text-white">Reviews</a></li>
              <li><a href="#location" className="hover:text-white">Location</a></li>
            </ul>
          </div>
        </div>

        <nav className="mt-10 border-t border-white/10 pt-6" aria-label="Popular pages">
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--color-gold-bright)]">Explore</p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-cream/75">
            <a href="/pizza-party-long-branch/" className="hover:text-white">Kids’ Pizza Parties</a>
            <a href="/late-night-pizza-long-branch/" className="hover:text-white">Late-Night Pizza</a>
            {/* /vip-club/ had zero inbound links anywhere on the site, so Google never learned it
                existed ("URL is unknown to Google"). One footer link makes it discoverable. */}
            <a href="/vip-club/" className="hover:text-white">VIP Club &mdash; free pie</a>
            <a href="/delivery/" className="hover:text-white">Delivery Areas &amp; Fees</a>
            <a href="/gluten-free-pizza-long-branch/" className="hover:text-white">Gluten-Free Pizza</a>
            <a href="/vegan-pizza-long-branch/" className="hover:text-white">Vegan Pizza</a>
            <a href="/catering-long-branch/" className="hover:text-white">Catering in Long Branch</a>
            <a href="/pizza-delivery-pier-village/" className="hover:text-white">Pier Village Delivery</a>
            <a href="/pizza-delivery-west-end-long-branch/" className="hover:text-white">West End Pizza</a>
            <a href="/pizza-delivery-elberon/" className="hover:text-white">Elberon Delivery</a>
          </div>
        </nav>

        <div className="mt-10 border-t border-white/10 pt-6 text-xs leading-relaxed text-cream/55">
          <p>
            © {year} Gigi's NY Style Pizza — Long Branch. This website represents the
            Long Branch location only. Menu items, pricing, hours, and availability
            are subject to change.
          </p>
          <p className="mt-2">
            Operated by GIGIS NY STYLE PIZZA LONG BRANCH LLC
            {" · "}
            <a href="/privacy-policy/" className="hover:text-white">Privacy Policy</a>
            {" · "}
            <a href="/sms-terms/" className="hover:text-white">SMS Terms</a>
            {" · "}
            Website by <a href="https://clickmingo.com" target="_blank" rel="noopener" className="hover:text-white">ClickMingo</a>
            {" · "}
            <a href="https://thejorgeramirezgroup.com" target="_blank" rel="noopener" title="New Jersey Real Estate — The Jorge Ramirez Group" className="hover:text-white">The Jorge Ramirez Group</a>
          </p>
          {/* Gigi's also has a listing on Slice. Kept at the very bottom, below the fine print,
              so the site's own ordering (which pays Gigi's in full) stays the primary path. */}
          <p className="mt-5 flex items-center justify-center gap-2 text-xs text-white/45 md:justify-start">
            <span>Also on</span>
            <a
              href="https://slicelife.com/restaurants/nj/long-branch/07740/gigi-s-ny-style-pizza-restaurant/menu"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Order from Gigi's on Slice (opens in a new tab)"
              className="inline-flex items-center transition hover:opacity-80"
            >
              <img
                src="/img/slice-logo.png"
                alt="Slice"
                width={96}
                height={96}
                /* Deliberately NOT loading="lazy": at 7 KB it saves nothing, and in the footer the
                   lazy heuristic never fired — the image stayed unloaded (currentSrc empty) so the
                   logo simply never appeared. */
                decoding="async"
                className="h-7 w-7 rounded-[6px]"
              />
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
