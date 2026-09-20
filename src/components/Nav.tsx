import { useEffect, useRef, useState } from "react";
import { LOCATION } from "../data/location";
import { MenuIcon, PhoneIcon } from "./Icons";
import { CartButton } from "../ordering/CartButton";
import { useCart } from "../ordering/CartContext";
import { goToMenu } from "../lib/goToMenu";
import logoPng from "../assets/brand/logo.png";

const LINKS = [
  { href: "/account/", label: "My rewards" },
  { href: "#menu", label: "Menu" },
  { href: "#breakfast", label: "Breakfast" },
  // Real page (not an in-page anchor) — the kids' pizza-party landing page.
  { href: "/pizza-party-long-branch/", label: "Pizza Parties" },
  { href: "#about", label: "About" },
  { href: "#reviews", label: "Reviews" },
  { href: "#location", label: "Visit" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuSheetRef = useRef<HTMLDivElement>(null);
  // Keep the compact controls through tablet widths. On expansion, release the
  // drawer's scroll lock rather than hiding an open modal behind desktop navigation.
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1280px)");
    const closeOnDesktop = () => { if (desktop.matches) setMobileOpen(false); };
    closeOnDesktop();
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  // The closed drawer stays in the DOM for its slide animation. pointer-events
  // hides it from the mouse but not from the keyboard, so its links stayed in the
  // tab order — 21 invisible stops before the page content, and focusable nodes
  // inside aria-hidden. `inert` removes them from focus and the a11y tree without
  // touching the transform the animation needs.
  useEffect(() => {
    const el = drawerRef.current;
    if (el) el.inert = !mobileOpen;
  }, [mobileOpen]);
  useEffect(() => {
    if (!mobileOpen) return;
    const sheet = menuSheetRef.current;
    const trigger = menuButtonRef.current;
    if (!sheet) return;
    const focusable = () => Array.from(sheet.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex="0"]',
    )).filter(element => element.getClientRects().length > 0);
    const focusFirst = () => (focusable()[0] ?? sheet).focus({ preventScroll: true });
    focusFirst();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) {
        event.preventDefault();
        sheet.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !sheet.contains(event.target)) focusFirst();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      // Do not steal focus if another dialog (such as the cart) has taken it.
      if (sheet.contains(document.activeElement) || document.activeElement === document.body) {
        if (trigger?.getClientRects().length) trigger.focus({ preventScroll: true });
      }
    };
  }, [mobileOpen]);
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
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[var(--color-chrome)]/95 shadow-[0_4px_20px_rgba(0,0,0,0.06)] backdrop-blur-md"
          : "bg-white/95 border-b border-[var(--color-line)]"
      }`}
    >
      <div className="container-x flex h-20 items-center justify-between gap-4 md:h-28">
        <a href="#top" className="flex shrink-0 items-center gap-2" aria-label="Gigi's NY Style Pizza — Long Branch home">
          <img
            src={logoPng}
            alt="Gigi's NY Style Pizza & Restaurant logo"
            className={`h-14 w-auto md:h-20 ${scrolled ? "" : ""}`}
            width={96}
            height={104}
          />
          <span className="sr-only">Gigi's NY Style Pizza — Long Branch</span>
        </a>

        <nav className="hidden shrink-0 items-center gap-4 xl:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`whitespace-nowrap text-xs font-semibold uppercase tracking-[0.1em] transition hover:text-[var(--color-action-text)] ${
                scrolled ? "text-[var(--color-copy-soft)]" : "text-[var(--color-copy-soft)]"
              }`}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden shrink-0 items-center gap-2 xl:flex">
          <CartButton variant="gold" label="Order" />
          <a href={`tel:${LOCATION.phoneTel}`} className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[var(--color-brand-red)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(155,18,26,0.35)] transition hover:bg-[var(--color-brand-red-dark)]" aria-label={`Call Gigi's Long Branch at ${LOCATION.phone}`}>
            <PhoneIcon className="h-4 w-4" />
            {LOCATION.phone}
          </a>
        </div>

        {/* Mobile: cart + hamburger */}
        <div className="flex shrink-0 items-center gap-2 xl:hidden">
          <CartButton label="" className="min-h-11 min-w-11 justify-center !px-3" />
          <a href={`tel:${LOCATION.phoneTel}`} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-[var(--color-brand-red)] p-3 text-white shadow-[var(--shadow-red)]" aria-label={`Call Gigi's Long Branch at ${LOCATION.phone}`}>
            <PhoneIcon className="h-4 w-4" />
          </a>
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            aria-controls="mobile-navigation"
            aria-haspopup="dialog"
            className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border p-3 transition ${
              scrolled
                ? "border-[var(--color-line)] bg-[var(--color-panel)] text-[var(--color-copy)]"
                : "border-[var(--color-line)] bg-white text-[var(--color-copy)]"
            }`}
          >
            <MenuIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      <div
        ref={drawerRef}
        className={`fixed inset-0 z-50 xl:hidden ${mobileOpen ? "pointer-events-auto" : "pointer-events-none"}`}
        aria-hidden={!mobileOpen}
      >
        {/* backdrop */}
        <div
          onClick={() => setMobileOpen(false)}
          className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${mobileOpen ? "opacity-100" : "opacity-0"}`}
        />
        {/* sheet */}
        <div
          ref={menuSheetRef}
          id="mobile-navigation"
          role="dialog"
          aria-modal={mobileOpen ? true : undefined}
          aria-label="Gigi's navigation menu"
          tabIndex={-1}
          className={`absolute inset-x-0 top-0 max-h-dvh origin-top overflow-y-auto bg-[var(--color-chrome)] px-6 pb-8 pt-6 shadow-[var(--shadow-lg)] transition-transform duration-300 ease-out ${
            mobileOpen ? "translate-y-0" : "-translate-y-full"
          }`}
        >
          <div className="flex items-center justify-between">
            <img src={logoPng} alt="Gigi's" className="h-14 w-auto" />
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-panel)]"
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
                className="border-b border-[var(--color-line)] py-4 font-display text-3xl text-[var(--color-copy)] transition hover:text-[var(--color-action-text)]"
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
                // "Start your order" on an empty cart opened an empty drawer, not the menu.
                if (cart.count > 0) cart.openCart();
                else goToMenu();
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
