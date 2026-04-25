import { useState } from "react";
import { FAQS } from "../data/seo";

export function FAQ() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <section id="faq" className="scroll-mt-20 py-20 md:py-28">
      <div className="container-x">
        <div className="mx-auto max-w-2xl text-center" data-reveal>
          <span className="eyebrow">Quick answers</span>
          <h2 className="mt-3 text-4xl md:text-5xl">Frequently asked</h2>
          <p className="mt-4 text-base text-[var(--color-ink-soft)] md:text-lg">
            Hours, delivery, reservations — the things people ask before they
            order.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-3xl space-y-3" data-reveal>
          {FAQS.map((f, i) => {
            const isOpen = openIdx === i;
            return (
              <div
                key={f.q}
                className="overflow-hidden rounded-2xl border border-[var(--color-ink)]/10 bg-white shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)]"
              >
                <button
                  type="button"
                  onClick={() => setOpenIdx(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-panel-${i}`}
                  className="flex min-h-[56px] w-full items-center justify-between gap-4 px-5 py-4 text-left font-serif text-base font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-cream)] md:text-lg"
                >
                  <span>{f.q}</span>
                  <span
                    aria-hidden="true"
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-red)]/10 text-[var(--color-brand-red)] transition-transform duration-300 ${
                      isOpen ? "rotate-45" : ""
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </span>
                </button>
                <div
                  id={`faq-panel-${i}`}
                  role="region"
                  className={`grid transition-all duration-300 ease-out ${
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="px-5 pb-5 text-sm leading-relaxed text-[var(--color-ink-soft)] md:text-base">
                      {f.a}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
