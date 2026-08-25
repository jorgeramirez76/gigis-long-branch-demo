import { useEffect, useMemo, useRef, useState } from "react";
import type { MenuItem, OptionGroup } from "../data/menu";
import { MAX_LINE_QTY, money, parsePrice, useCart, type CartOption } from "./CartContext";
import {
  HALF_TOPPING_DISPLAY_CENTS,
  TOPPING_CHARGE_CENTS,
  TOPPING_DISPLAY_CENTS,
  isToppingsGroup,
  placementDelta,
  type ToppingPlacement,
} from "../data/menuToppings";

/** Charge-priced toppings can go on half the pie; everything else is whole-only. */
function canPlace(group: OptionGroup, choiceDelta?: string): boolean {
  return isToppingsGroup(group.group) && parsePrice(choiceDelta) === TOPPING_CHARGE_CENTS;
}

/** What a topping SHOWS here ("+$3"); the 12¢ card-pricing remainder is itemized at
 *  checkout (Tommy's spec, 2026-08-19). The charged delta stays TOPPING_CHARGE_CENTS. */
const TOPPING_DISPLAY_LABEL = `+$${TOPPING_DISPLAY_CENTS / 100}`;

// Placement pills show the flat display rates; the stored cart delta still comes from
// placementDelta() on the real charge values below.
const PLACEMENTS: { value: ToppingPlacement; label: string; price: number }[] = [
  { value: "whole", label: "Whole pie", price: TOPPING_DISPLAY_CENTS },
  { value: "left", label: "Left half", price: HALF_TOPPING_DISPLAY_CENTS },
  { value: "right", label: "Right half", price: HALF_TOPPING_DISPLAY_CENTS },
];

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
  placements,
  onPlacement,
}: {
  group: OptionGroup;
  selected: Set<string>;
  onToggle: (choiceName: string, single: boolean, max: number | null) => void;
  placements: Record<string, ToppingPlacement>;
  onPlacement: (choiceName: string, placement: ToppingPlacement) => void;
}) {
  const { single, required, max } = ruleConstraints(group.rule);
  const atMax = max != null && selected.size >= max;
  // Selected toppings that can go on half the pie get a placement row below the
  // chips — the kitchen ticket prints whatever is chosen here.
  const placeable = group.choices.filter((c) => selected.has(c.name) && canPlace(group, c.delta));
  return (
    <fieldset className="border-t border-[var(--color-ink)]/8 pt-4">
      <legend className="flex items-baseline gap-2 pb-2">
        <span className="text-sm font-bold text-[var(--color-ink)]">{group.group}</span>
        <span className="text-xs text-[var(--color-ink)]/60">
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
              aria-pressed={on}
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
                <span className={on ? "text-white/80" : "font-semibold text-[var(--color-brand-red)]"}>
                  {canPlace(group, c.delta) ? TOPPING_DISPLAY_LABEL : c.delta}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {placeable.length > 0 && (
        <div className="mt-3 space-y-2 rounded-xl bg-[var(--color-cream)]/60 p-3">
          {placeable.map((c) => {
            const current = placements[c.name] ?? "whole";
            return (
              <div key={c.name} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--color-ink)]">{c.name}</span>
                <div className="flex rounded-full border border-[var(--color-ink)]/15 bg-white p-0.5" role="radiogroup" aria-label={`Where does ${c.name} go?`}>
                  {PLACEMENTS.map((p) => {
                    const on = current === p.value;
                    return (
                      <button
                        key={p.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => onPlacement(c.name, p.value)}
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                          on ? "bg-[var(--color-brand-red)] text-white" : "text-[var(--color-ink)]/70 hover:text-[var(--color-ink)]"
                        }`}
                      >
                        {p.label} {money(p.price).replace(".00", "")}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {group.choices.some((c) => canPlace(group, c.delta)) && (
        // NJ card-surcharge rules require the adjustment disclosed BEFORE checkout, so this
        // note rides with the prices it applies to.
        <p className="mt-2 text-xs text-[var(--color-ink)]/50">
          Card pricing adds 12¢ per topping (8¢ per half) at checkout.
        </p>
      )}
    </fieldset>
  );
}

export function ItemModal({ item, categoryId, onClose }: { item: MenuItem; categoryId: string; onClose: () => void }) {
  const cart = useCart();
  const basePrice = parsePrice(item.price);
  const groups = item.options ?? [];
  // selected choice names per group index
  const [selected, setSelected] = useState<Record<number, Set<string>>>({});
  // topping name → where it goes (only charge-priced toppings; default whole pie)
  const [placements, setPlacements] = useState<Record<string, ToppingPlacement>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  // Same modal contract as checkout: focus stays inside, Escape exits, and the
  // page behind is unavailable to assistive tech while the dialog is open.
  useEffect(() => {
    const panel = panelRef.current;
    const restoreTo = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const hidden: Array<{ el: HTMLElement; aria: string | null; inert: boolean }> = [];
    let branch: HTMLElement | null = backdropRef.current;
    while (branch?.parentElement && branch.parentElement !== document.body) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        hidden.push({ el: sibling, aria: sibling.getAttribute("aria-hidden"), inert: sibling.inert });
        sibling.setAttribute("aria-hidden", "true");
        sibling.inert = true;
      }
      branch = branch.parentElement;
    }
    panel?.querySelector<HTMLElement>("input,button,select,textarea,[tabindex]:not([tabindex='-1'])")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])"),
      ).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      for (const item of hidden) {
        if (item.aria == null) item.el.removeAttribute("aria-hidden");
        else item.el.setAttribute("aria-hidden", item.aria);
        item.el.inert = item.inert;
      }
      restoreTo?.focus?.();
    };
  }, [onClose]);

  const unmetRequired = groups.some((g, gi) => {
    const { required } = ruleConstraints(g.rule);
    return required && !(selected[gi] && selected[gi].size > 0);
  });

  // What the button SHOWS: toppings at their flat display rate. The 12¢/8¢ card-pricing
  // remainder is itemized at checkout; the cart line is priced from the real deltas when
  // it is added (placementDelta below), so charged amounts are untouched by this.
  const displayDeltaCents = useMemo(() => {
    let d = 0;
    groups.forEach((g, gi) => {
      const sel = selected[gi];
      if (!sel) return;
      g.choices.forEach((c) => {
        if (!sel.has(c.name)) return;
        if (canPlace(g, c.delta)) {
          d += (placements[c.name] ?? "whole") === "whole" ? TOPPING_DISPLAY_CENTS : HALF_TOPPING_DISPLAY_CENTS;
        } else {
          d += parsePrice(c.delta);
        }
      });
    });
    return d;
  }, [groups, selected, placements]);
  const displayUnit = basePrice + displayDeltaCents;

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
        if (!sel.has(c.name)) return;
        if (canPlace(g, c.delta)) {
          const placement = placements[c.name] ?? "whole";
          options.push({ group: g.group, name: c.name, delta: placementDelta(parsePrice(c.delta), placement), placement });
        } else {
          options.push({ group: g.group, name: c.name, delta: parsePrice(c.delta) });
        }
      });
    });
    cart.addLine({ itemName: item.name, categoryId, basePrice, options, quantity, notes: notes.trim() || undefined });
    onClose();
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Add ${item.name}`}
      // Backdrop mousedown only — an onClick here closed the modal when a drag
      // that began on the option list happened to end outside it.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-[var(--shadow-lg)] sm:rounded-3xl"
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
              placements={placements}
              onPlacement={(name, placement) => setPlacements((prev) => ({ ...prev, [name]: placement }))}
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
              maxLength={500}
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
              onClick={() => setQuantity((q) => Math.min(MAX_LINE_QTY, q + 1))}
              disabled={quantity >= MAX_LINE_QTY}
              className="px-3.5 py-2 text-lg text-[var(--color-ink)] disabled:opacity-30"
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
            <span>{money(displayUnit * quantity)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
