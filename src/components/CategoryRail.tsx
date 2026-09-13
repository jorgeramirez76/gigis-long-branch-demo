import { useCallback, useEffect, useRef } from "react";

const motion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" as const : "smooth" as const;

const categoryIcon = (name: string) => {
  if (/pizza|slice|square/i.test(name)) return "🍕";
  if (/breakfast/i.test(name)) return "🍳";
  if (/salad/i.test(name)) return "🥗";
  if (/burger/i.test(name)) return "🍔";
  if (/sandwich|sub|hero|samm|club/i.test(name)) return "🥪";
  if (/wrap|panini/i.test(name)) return "🌯";
  if (/mexican/i.test(name)) return "🌮";
  if (/hot dog/i.test(name)) return "🌭";
  if (/seafood/i.test(name)) return "🍤";
  if (/pasta|entree/i.test(name)) return "🍝";
  if (/chicken|wing/i.test(name)) return "🍗";
  if (/dessert/i.test(name)) return "🍰";
  if (/drink/i.test(name)) return "🥤";
  if (/appetizer|snack|fries/i.test(name)) return "🍟";
  if (/kids/i.test(name)) return "🧀";
  return "🍽️";
};

export function CategoryRail({ categories, activeId, onSelect }: {
  categories: { id: string; name: string }[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);

  const reveal = useCallback((button: HTMLElement) => {
    const row = rail.current;
    if (!row) return;
    const bounds = row.getBoundingClientRect();
    const item = button.getBoundingClientRect();
    if (item.left < bounds.left || item.right > bounds.right) {
      row.scrollBy({ left: item.left - bounds.left - (bounds.width - item.width) / 2, behavior: motion() });
    }
  }, []);
  useEffect(() => {
    const selected = rail.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (selected) reveal(selected);
  }, [activeId, reveal]);
  return (
    <nav aria-label="Menu categories" className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-[var(--color-copy-soft)]">Browse categories <span className="ml-1 font-normal">· Swipe to see more</span></p>
        <div className="flex gap-1">
          <button type="button" aria-label="Previous categories" onClick={() => rail.current?.scrollBy({left: -rail.current.clientWidth * .75, behavior: motion()})} className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-line)] text-lg hover:bg-[var(--color-panel)]">←</button>
          <button type="button" aria-label="More categories" onClick={() => rail.current?.scrollBy({left: rail.current.clientWidth * .75, behavior: motion()})} className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-line)] text-lg hover:bg-[var(--color-panel)]">→</button>
        </div>
      </div>
      <div ref={rail} className="flex gap-3 overflow-x-auto overscroll-x-contain pb-3 pt-1" onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const buttons = Array.from(rail.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (current < 0) return;
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
        event.preventDefault();
        buttons[next].focus({preventScroll:true});
        reveal(buttons[next]);
      }}>
        {categories.map(category => {
          const selected = category.id === activeId;
          return <button type="button" key={category.id} data-metric="category_select" aria-pressed={selected} onClick={() => onSelect(category.id)}
            className="group flex w-[84px] shrink-0 flex-col items-center gap-2 rounded-lg px-1 py-1 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-brand-red)] md:w-[96px]">
            <span aria-hidden="true" className={`flex h-[72px] w-[72px] items-center justify-center rounded-full border-2 text-3xl transition-colors md:h-20 md:w-20 ${selected ? "border-[var(--color-gold-bright)] bg-[var(--color-brand-red)]" : "border-[var(--color-line)] bg-[var(--color-panel)] group-hover:border-[var(--color-gold-bright)]"}`}>{categoryIcon(category.name)}</span>
            <span className={`text-xs font-semibold leading-tight ${selected ? "text-[var(--color-action-text)]" : "text-[var(--color-copy)]"}`}>{category.name}</span>
          </button>;
        })}
      </div>
    </nav>
  );
}
