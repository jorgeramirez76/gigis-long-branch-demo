import { useEffect, useState } from "react";
import { DIRECTIONS_URL, LOCATION, ORDER_ONLINE_URL } from "../data/location";
import { ArrowIcon, MenuIcon, PhoneIcon, PinIcon } from "./Icons";

/**
 * Sticky mobile bottom bar: Call / Order / Menu / Directions.
 * Visible only below md. Slides up on first scroll to avoid covering hero CTAs.
 * Respects iOS safe-area-inset.
 */
export function StickyBar() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 120);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/97 backdrop-blur transition-transform duration-300 md:hidden ${
        show ? "translate-y-0" : "translate-y-full"
      }`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto grid max-w-md grid-cols-4">
        <a
          href={`tel:${LOCATION.phoneTel}`}
          className="flex flex-col items-center gap-1 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--color-brand-red)] transition active:bg-[var(--color-brand-red)]/5"
          aria-label={`Call Gigi's Long Branch at ${LOCATION.phone}`}
        >
          <PhoneIcon className="h-[22px] w-[22px]" />
          Call
        </a>
        <a
          href={ORDER_ONLINE_URL}
          target="_blank"
          rel="noreferrer"
          className="flex flex-col items-center gap-1 border-l border-black/10 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink)] transition active:bg-black/5"
        >
          <ArrowIcon className="h-[22px] w-[22px]" />
          Order
        </a>
        <a
          href="#menu"
          className="flex flex-col items-center gap-1 border-l border-black/10 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink)] transition active:bg-black/5"
        >
          <MenuIcon className="h-[22px] w-[22px]" />
          Menu
        </a>
        <a
          href={DIRECTIONS_URL}
          target="_blank"
          rel="noreferrer"
          className="flex flex-col items-center gap-1 border-l border-black/10 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink)] transition active:bg-black/5"
        >
          <PinIcon className="h-[22px] w-[22px]" />
          Directions
        </a>
      </div>
    </div>
  );
}
