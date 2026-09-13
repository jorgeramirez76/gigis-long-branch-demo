import { FAVORITES } from "../data/gallery";
import { useMenu } from "../hooks/useMenu";
import { useOrderingUI } from "../ordering/OrderingProvider";


export function FanFavorites() {
  const menu = useMenu();
  const { configureItem, isOrderable } = useOrderingUI();
  return (
    <section id="fan-favorites" aria-label="Fan favorites" className="scroll-mt-20 bg-[var(--color-page)] py-8 md:py-12">
      <div className="container-x">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div><span className="eyebrow">Start with a favorite</span><h2 className="mt-2 text-3xl md:text-4xl">What sounds good?</h2></div>
          <a href="#menu" className="py-2 text-sm font-semibold text-[var(--color-action-text)] underline underline-offset-4">See the full menu →</a>
        </div>
        <p className="mb-4 text-sm text-[var(--color-copy-soft)]">Prefer a square pie? Explore our <a href="/square-pizza-long-branch/" className="font-semibold underline underline-offset-4">Grandma and Sicilian square pizza options</a>.</p>
        <div className="grid grid-flow-col auto-cols-[80%] gap-4 overflow-x-auto pb-3 sm:auto-cols-[45%] lg:grid-flow-row lg:grid-cols-2 lg:max-w-3xl">
          {FAVORITES.map(f => {
            const category = menu.find(cat => cat.items.some(item => item.name === f.menuName));
            const item = category?.items.find(item => item.name === f.menuName);
            return (
              <article key={f.menuName} className="flex flex-col overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)]">
                <picture>
                  <source type="image/webp" srcSet={f.webp} sizes="(min-width: 1024px) 376px, (min-width: 640px) 45vw, 80vw" />
                  <img src={f.src} alt={f.alt} loading="lazy" decoding="async" className="aspect-[4/3] w-full object-cover" />
                </picture>
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-display text-2xl leading-tight">{f.name}</h3>
                    {item && <span className="font-bold text-[var(--color-action-text)]">{item.price}</span>}
                  </div>
                  <p className="mb-4 mt-2 text-sm leading-relaxed text-[var(--color-copy-soft)]">{f.blurb}</p>
                  {item && category && isOrderable(item) ? (
                    <button type="button" onClick={() => configureItem(item, category.id)} className="btn-primary mt-auto w-full text-sm" aria-label={`Customize ${f.name}`}>Customize &amp; add</button>
                  ) : <a href="#menu" className="mt-auto py-3 text-sm font-semibold underline underline-offset-4">Browse available items</a>}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
