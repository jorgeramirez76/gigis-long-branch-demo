import { useEffect, useState } from "react";
import { LOCATION } from "../data/location";
import { MenuIcon, PhoneIcon } from "./Icons";
import { CartButton } from "../ordering/CartButton";
import { useCart } from "../ordering/CartContext";
import logoPng from "../assets/brand/logo.png";

const LINKS = [
  { href: "#menu", label: "Menu" },
  { href: "#about", label: "About" },
  { href: "#reviews", label: "Reviews" },
  { href: "#location", label: "Visit" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const cart = useCart();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll when mobile menu open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-all duration-300 ${
        scrolled
          ? "bg-[var(--color-cream)]/95 shadow-[0_4px_20px_rgba(0,0,0,0.06)] backdrop-blur-md"
          : "bg-gradient-to-b from-black/40 to-transparent"
      }`}
    >
      <div className="container-x flex h-20 items-center justify-between md:h-28">
        <a href="#top" className="flex items-center gap-2" aria-label="Gigi's NY Style Pizza — Long Branch home">
          <img
            src={logoPng}
            alt="Gigi's NY Style Pizza & Restaurant logo"
            className={`h-14 w-auto md:h-20 ${scrolled ? "" : "drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)]"}`}
            width={96}
            height={79}
          />
          <span className="sr-only">Gigi's NY Style Pizza — Long Branch</span>
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`text-sm font-semibold uppercase tracking-[0.18em] transition hover:text-[var(--color-brand-red)] ${
                scrolled ? "text-[var(--color-ink-soft)]" : "text-white/95 drop-shadow"
              }`}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <CartButton variant="gold" label="Order" />
          <a href={`tel:${LOCATION.phoneTel}`} className="inline-flex items-center gap-2 rounded-full bg-[var(--color-brand-red)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(155,18,26,0.35)] transition hover:bg-[var(--color-brand-red-dark)]" aria-label={`Call Gigi's Long Branch at ${LOCATION.phone}`}>
            <PhoneIcon className="h-4 w-4" />
            {LOCATION.phone}
          </a>
        </div>

        {/* Mobile: cart + hamburger */}
        <div className="flex items-center gap-2 md:hidden">
          <CartButton label="" className="!px-3" />
          <a href={`tel:${LOCATION.phoneTel}`} className="inline-flex items-center justify-center rounded-full bg-[var(--color-brand-red)] p-3 text-white shadow-[var(--shadow-red)]" aria-label={`Call Gigi's Long Branch at ${LOCATION.phone}`}>
            <PhoneIcon className="h-4 w-4" />
          </a>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            className={`inline-flex items-center justify-center rounded-full border p-3 transition ${
              scrolled
                ? "border-[var(--color-ink)]/15 bg-white text-[var(--color-ink)]"
                : "border-white/40 bg-black/25 text-white backdrop-blur"
            }`}
          >
            <MenuIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      <div
        className={`fixed inset-0 z-50 md:hidden ${mobileOpen ? "pointer-events-auto" : "pointer-events-none"}`}
        aria-hidden={!mobileOpen}
      >
        {/* backdrop */}
        <div
          onClick={() => setMobileOpen(false)}
          className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${mobileOpen ? "opacity-100" : "opacity-0"}`}
        />
        {/* sheet */}
        <div
          className={`absolute inset-x-0 top-0 origin-top bg-[var(--color-cream)] px-6 pb-8 pt-6 shadow-[var(--shadow-lg)] transition-transform duration-300 ease-out ${
            mobileOpen ? "translate-y-0" : "-translate-y-full"
          }`}
        >
          <div className="flex items-center justify-between">
            <img src={logoPng} alt="Gigi's" className="h-14 w-auto" />
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-ink)]/15 bg-white"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <nav className="mt-6 flex flex-col">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setMobileOpen(false)}
                className="border-b border-[var(--color-ink)]/10 py-4 font-display text-3xl text-[var(--color-ink)] transition hover:text-[var(--color-brand-red)]"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="mt-6 flex flex-col gap-2">
            <a href={`tel:${LOCATION.phoneTel}`} className="btn-primary w-full text-base">
              <PhoneIcon className="h-4 w-4" />
              Call {LOCATION.phone}
            </a>
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false);
                cart.openCart();
              }}
              className="btn-gold w-full text-base"
            >
              {cart.count > 0 ? `View your order · ${cart.count}` : "Start your order"}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
