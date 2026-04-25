import { useEffect } from "react";

/**
 * Global reveal driver. Marks elements with `data-reveal` as revealed when
 * they scroll into view. Also reveals anything already in or past the
 * viewport on mount (deep-links, programmatic scroll, back-button).
 */
export function useReveal() {
  useEffect(() => {
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) =>
        el.setAttribute("data-revealed", "true"),
      );
      return;
    }

    // Immediately reveal anything that is already on-screen OR above the viewport
    // (user deep-linked / refreshed mid-scroll — don't hide what they'd expect to see)
    const revealCurrent = () => {
      const vh = window.innerHeight;
      document
        .querySelectorAll<HTMLElement>("[data-reveal]:not([data-revealed])")
        .forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.top < vh * 0.9) el.setAttribute("data-revealed", "true");
        });
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).setAttribute("data-revealed", "true");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
    );

    const attach = () =>
      document
        .querySelectorAll<HTMLElement>("[data-reveal]:not([data-revealed])")
        .forEach((el) => io.observe(el));

    revealCurrent();
    attach();

    const mo = new MutationObserver(() => {
      revealCurrent();
      attach();
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);
}
