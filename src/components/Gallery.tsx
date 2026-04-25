import type { CSSProperties } from "react";
import { GALLERY } from "../data/gallery";

export function Gallery() {
  return (
    <section aria-label="Food gallery" className="relative py-14 md:py-24">
      <div className="container-x">
        <div className="mb-8 flex items-end justify-between gap-6 md:mb-10" data-reveal>
          <div>
            <span className="eyebrow">Straight from the oven</span>
            <h2 className="mt-3 text-4xl md:text-5xl">A quick taste</h2>
          </div>
          <p className="hidden max-w-sm text-right text-sm text-[var(--color-ink-soft)] md:block">
            Real New York slices, specialty pies, heroes, pasta — full neighborhood
            kitchen on Brighton Ave.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5">
          {GALLERY.map((img, i) => {
            const style: CSSProperties = {
              aspectRatio: "4/5",
              ["--delay" as string]: `${(i % 3) * 80}ms`,
            };
            return (
              <figure
                key={img.src}
                data-reveal={i % 2 === 0 ? "left" : "right"}
                style={style}
                className={`group relative overflow-hidden rounded-2xl bg-[var(--color-char)] shadow-[var(--shadow-md)] transition-shadow duration-300 hover:shadow-[var(--shadow-lg)] ${
                  i === 0 ? "col-span-2 row-span-2 md:col-span-2 md:row-span-2" : ""
                }`}
              >
                <img
                  src={img.src}
                  alt={img.alt}
                  loading={i < 2 ? "eager" : "lazy"}
                  decoding="async"
                  sizes={i === 0 ? "(min-width: 768px) 66vw, 100vw" : "(min-width: 768px) 33vw, 50vw"}
                  className="h-full w-full object-cover transition-transform duration-[900ms] ease-out will-change-transform group-hover:scale-[1.06]"
                />
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent opacity-95 transition-opacity duration-500 group-hover:opacity-90"
                />
                <figcaption className="absolute inset-x-0 bottom-0 p-4 md:p-5">
                  <p className="font-display text-2xl text-white md:text-3xl">
                    {img.caption}
                  </p>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </div>
    </section>
  );
}
