import { useMemo, useState } from "react";
import type { MenuItem, OptionGroup } from "../data/menu";
import { money, parsePrice, useCart, type CartOption } from "./CartContext";

/** Parse a human rule string into selection constraints. */
function ruleConstraints(rule?: string): { single: boolean; required: boolean; max: number | null } {
  const r = (rule ?? "").toLowerCase();
  const upTo = r.match(/up to (\d+)/);
  const chooseN = r.match(/choose (\d+)/);
  if (upTo) return { single: false, required: false, max: parseInt(upTo[1], 10) };
  if (chooseN) {
    const n = parseInt(chooseN[1], 10);
    return { single: n === 1, required: true, max: n };
  }
  // "Optional", "Add ...", or no rule → free multi-select
  return { single: false, required: false, max: null };
}

function GroupField({
  group,
  selected,
  onToggle,
}: {
  group: OptionGroup;
  selected: Set<string>;
  onToggle: (choiceName: string, single: boolean, max: number | null) => void;
}) {
  const { single, required, max } = ruleConstraints(group.rule);
  const atMax = max != null && selected.size >= max;
  return (
    <fieldset className="border-t border-[var(--color-ink)]/8 pt-4">
      <legend className="flex items-baseline gap-2 pb-2">
        <span className="text-sm font-bold text-[var(--color-ink)]">{group.group}</span>
        <span className="text-xs text-[var(--color-ink)]/45">
          {group.rule ?? "Optional"}
          {required && <span className="ml-1 font-semibold text-[var(--color-brand-red)]">*</span>}
        </span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {group.choices.map((c) => {
          const on = selected.has(c.name);
          const disabled = !on && atMax && !single;
          return (
            <button
              key={c.name}
              type="button"
              disabled={disabled}
              onClick={() => onToggle(c.name, single, max)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                on
                  ? "border-[var(--color-brand-red)] bg-[var(--color-brand-red)] text-white"
                  : disabled
                    ? "cursor-not-allowed border-[var(--color-ink)]/10 text-[var(--color-ink)]/30"
                    : "border-[var(--color-ink)]/15 text-[var(--color-ink)] hover:border-[var(--color-brand-red)]/50"
              }`}
            >
              {c.name}
              {c.delta && (
                <span className={on ? "text-white/80" : "font-semibold text-[var(--color-brand-red)]"}>{c.delta}</span>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function ItemModal({ item, categoryId, onClose }: { item: MenuItem; categoryId: string; onClose: () => void }) {
  const cart = useCart();
  const basePrice = parsePrice(item.price);
  const groups = item.options ?? [];
  // selected choice names per group index
  const [selected, setSelected] = useState<Record<number, Set<string>>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  const deltaCents = useMemo(() => {
    let d = 0;
    groups.forEach((g, gi) => {
      const sel = selected[gi];
      if (!sel) return;
      g.choices.forEach((c) => {
        if (sel.has(c.name)) d += parsePrice(c.delta);
      });
    });
    return d;
  }, [groups, selected]);

  const unmetRequired = groups.some((g, gi) => {
    const { required } = ruleConstraints(g.rule);
    return required && !(selected[gi] && selected[gi].size > 0);
  });

  const unit = basePrice + deltaCents;

  function toggle(gi: number, choiceName: string, single: boolean, max: number | null) {
    setSelected((prev) => {
      const cur = new Set(prev[gi] ?? []);
      if (single) {
        cur.clear();
        cur.add(choiceName);
      } else if (cur.has(choiceName)) {
        cur.delete(choiceName);
      } else if (max == null || cur.size < max) {
        cur.add(choiceName);
      }
      return { ...prev, [gi]: cur };
    });
  }

  function add() {
    const options: CartOption[] = [];
    groups.forEach((g, gi) => {
      const sel = selected[gi];
      if (!sel) return;
      g.choices.forEach((c) => {
        if (sel.has(c.name)) options.push({ group: g.group, name: c.name, delta: parsePrice(c.delta) });
      });
    });
    cart.addLine({ itemName: item.name, categoryId, basePrice, options, quantity, notes: notes.trim() || undefined });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Add ${item.name}`}
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-[var(--shadow-lg)] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-ink)]/8 p-5">
          <div>
            <h3 className="font-display text-2xl text-[var(--color-ink)]">{item.name}</h3>
            {item.description && (
              <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{item.description}</p>
            )}
            <p className="mt-1 font-bold text-[var(--color-brand-red)]">{money(basePrice)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-2 text-[var(--color-ink)]/50 hover:bg-[var(--color-cream)]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {groups.map((g, gi) => (
            <GroupField
              key={g.group + gi}
              group={g}
              selected={selected[gi] ?? new Set()}
              onToggle={(name, single, max) => toggle(gi, name, single, max)}
            />
          ))}
          <div className="border-t border-[var(--color-ink)]/8 pt-4">
            <label htmlFor="item-notes" className="mb-1.5 block text-sm font-bold text-[var(--color-ink)]">
              Special instructions
            </label>
            <textarea
              id="item-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. well done, cut in squares, no onions…"
              className="w-full resize-none rounded-xl border border-[var(--color-cream-darker)] bg-[var(--color-cream)]/40 px-3 py-2 text-sm focus:border-[var(--color-brand-red)] focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-[var(--color-ink)]/8 p-5">
          <div className="flex items-center rounded-full border border-[var(--color-ink)]/15">
            <button
              type="button"
              aria-label="Decrease quantity"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="px-3.5 py-2 text-lg text-[var(--color-ink)] disabled:opacity-30"
              disabled={quantity <= 1}
            >
              −
            </button>
            <span className="w-8 text-center font-semibold">{quantity}</span>
            <button
              type="button"
              aria-label="Increase quantity"
              onClick={() => setQuantity((q) => q + 1)}
              className="px-3.5 py-2 text-lg text-[var(--color-ink)]"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={add}
            disabled={unmetRequired}
            className="flex flex-1 items-center justify-between rounded-full bg-[var(--color-brand-red)] px-6 py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-[var(--shadow-red)] transition hover:bg-[var(--color-brand-red-bright)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>{unmetRequired ? "Choose required options" : "Add to order"}</span>
            <span>{money(unit * quantity)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
