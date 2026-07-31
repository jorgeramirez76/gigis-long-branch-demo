import { useEffect } from "react";

/**
 * Scroll to the URL's #anchor after the page has actually laid out.
 *
 * WHY: this is a prerendered single-page app. When someone arrives at
 * https://gigislongbranch.com/#vip-club the browser tries to honour the anchor against the
 * server-rendered HTML, but hydration, web fonts and the reveal animations all change layout
 * immediately afterwards, so the scroll lands back at the top. Measured before this fix: arriving
 * at #vip-club left the visitor at scrollY 10 on a 15,924px page, with the VIP form 13,406px below
 * the fold — they would have had to scroll past the entire homepage to find it.
 *
 * That matters because /vip — the QR code printed on 20,000 paper menus — redirects here, and it
 * also affects every external link into #menu, #breakfast, #reviews and so on.
 *
 * Behaviour is additive: no hash, no change. This only ever runs when a hash is present on load.
 */
export function useHashScroll() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;

    let id: string;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      return;
    }
    // Anchors come from the address bar, so treat them as untrusted input rather than
    // interpolating them into a selector.
    if (!/^[A-Za-z][\w-]*$/.test(id)) return;

    // The browser restores the previous scroll position on load; with scrollRestoration "auto"
    // that fires after hydration and puts us straight back at the top, undoing the anchor scroll.
    const prevRestoration = history.scrollRestoration;
    try { history.scrollRestoration = "manual"; } catch { /* not supported */ }

    let cancelled = false;
    let settleTimer: number | undefined;
    const start = Date.now();

    // Re-assert the scroll while layout is still settling. Each attempt re-measures, so the final
    // position is correct even if fonts or reveals shift things mid-flight.
    //
    // Must be ONE instant scrollTo, not scrollIntoView + scrollBy. The site CSS sets
    // `scroll-behavior: smooth`, so scrollIntoView starts an ANIMATED scroll — and a scrollBy
    // issued right after cancels that in-flight animation and applies its delta from the current
    // position, which is still the top. Net effect observed in production: the page never moved.
    // behavior:"instant" bypasses the CSS smooth behavior entirely.
    const NAV_OFFSET = 72; // sticky nav height — keep the section heading visible below it
    const attempt = () => {
      if (cancelled) return;
      const el = document.getElementById(id);
      if (el) {
        const y = el.getBoundingClientRect().top + window.scrollY - NAV_OFFSET;
        window.scrollTo({ top: Math.max(0, y), behavior: "instant" as ScrollBehavior });
        (window as unknown as Record<string, unknown>).__hashScroll = { id, y: Math.round(y) };
      }
      // Keep correcting for a short window, then stop so we never fight the user's own scrolling.
      if (Date.now() - start < 2500) {
        settleTimer = window.setTimeout(attempt, 150);
      }
    };

    // Fire immediately, then keep correcting on a timer. Deliberately NOT gated on
    // requestAnimationFrame: rAF is throttled to zero in a backgrounded or non-visible tab, so the
    // very first attempt could never run there — which is exactly what happened in testing (the
    // effect ran and set scrollRestoration, but the scroll itself never fired). setTimeout still
    // runs when throttled, so this works whether or not the tab is painting.
    attempt();

    // If a user scrolls deliberately, stop correcting immediately.
    const stop = () => {
      cancelled = true;
      if (settleTimer) window.clearTimeout(settleTimer);
    };
    window.addEventListener("wheel", stop, { passive: true, once: true });
    window.addEventListener("touchstart", stop, { passive: true, once: true });

    return () => {
      cancelled = true;
      if (settleTimer) window.clearTimeout(settleTimer);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      try { history.scrollRestoration = prevRestoration; } catch { /* ignore */ }
    };
  }, []);
}
