import type { MenuCategory, MenuItem, OptionGroup, OptionChoice } from "./menuTypes.js";

/**
 * Puts a price on pizza toppings.
 *
 * Clover models a topping as TWO modifiers: the topping itself (group "TOPPING",
 * every modifier $0.00) and a separate charge line (group "$ TOPPING $" — Full
 * Topping $3.12, half-pie $2.08). At the register staff ring both. The website
 * mirrored that structure faithfully, which meant a customer could tick Pepperoni
 * and pay nothing: five of the first fifteen orders went out with free toppings,
 * $32.24 of them.
 *
 * So the charge is folded into the topping itself here — one place, applied to the
 * menu every part of the site reads, so the price a customer sees, the price the
 * cart totals, and the price api/lib/menuCatalog.ts charges cannot disagree. The
 * separate charge group is then dropped: leaving it visible would let the same
 * customer pay for a topping twice.
 *
 * Half-pie toppings ($2.08 a side) are ordered via per-topping placement
 * (whole / left half / right half — see ToppingPlacement below); the kitchen
 * ticket prints where every topping goes.
 */

/** Group names as they appear in the generated menu (mapped from Clover in data/clover/sync-config.json). */
export const TOPPING_GROUP = "Toppings";
export const TOPPING_CHARGE_GROUP = "Topping Charges (Whole / Half Pie)";

/** "Toppings" wherever it appears — the classified data also left one item with
 * Clover's raw group name "TOPPING" (Two Pie Special), which must fold too. */
export function isToppingsGroup(name: string): boolean {
  return /^toppings?$/i.test(name.trim());
}

/** A staff charge group is recognized by its CONTENT, not its display name: the
 * classified data renamed "$ TOPPING $" to "Topping Charges (Whole / Half Pie)"
 * on pizzas but to "Extra Toppings" on calzones (and left it raw on one item).
 * Matching the name alone left the alias purchasable — a calzone customer could
 * pay the folded topping price AND tick "Full Topping" again. */
const CHARGE_LINE_RE = /^((1st|2nd)\s+half(\s+max)?|full\s+(max|topping))$/i;
export function isToppingChargeGroup(g: OptionGroup): boolean {
  return g.choices.length > 0 && g.choices.every((c) => CHARGE_LINE_RE.test(c.name.trim()));
}

/** Clover group "$ TOPPING $" → "Full Topping". The nightly refresh re-checks this
 *  against the live POS and reports a mismatch rather than silently repricing. */
export const TOPPING_CHARGE_CENTS = 312;
/** Clover "$ TOPPING $" → "1st Half" / "2nd Half" — a topping on half the pie. */
export const HALF_TOPPING_CHARGE_CENTS = 208;

/**
 * Where a topping goes on the pie. Only toppings priced by the folded charge
 * (i.e. delta === TOPPING_CHARGE_CENTS) offer a choice — a topping with its own
 * Clover price (Penne Pasta $1.04) has no half-pie rate on the POS, so it stays
 * whole-pie only. The kitchen ticket prints the placement for every topping.
 */
export type ToppingPlacement = "whole" | "left" | "right";

export function isToppingPlacement(v: unknown): v is ToppingPlacement {
  return v === "whole" || v === "left" || v === "right";
}

/** Charge for a topping given where it goes. Non-charge-priced deltas pass through. */
export function placementDelta(baseDelta: number, placement?: string): number {
  if (baseDelta === TOPPING_CHARGE_CENTS && (placement === "left" || placement === "right")) {
    return HALF_TOPPING_CHARGE_CENTS;
  }
  return baseDelta;
}

/** Customer-facing suffix: "Sausage (left half)". Whole pie stays unannotated. */
export function placementSuffix(placement?: string): string {
  if (placement === "left") return " (left half)";
  if (placement === "right") return " (right half)";
  return "";
}

const display = (cents: number) => `+$${(cents / 100).toFixed(2)}`;

/** The pizza blurb promises half-pie options this removes from the site. */
function fixBlurb(blurb?: string): string | undefined {
  return blurb?.replace(
    "Toppings and half-pie options under each pie.",
    "Toppings can go on the whole pie or either half — pick per topping.",
  );
}

/** Price every topping, and remove the staff-facing charge group.
 *
 * Scoped to items that actually CARRY a charge group (pizzas, calzones, the
 * specials): that is Clover's own signal that this item's toppings are billed.
 * Sandwiches and burgers also have a group named "Toppings" — Lettuce, Mayo —
 * that Clover prices at $0.00; folding by group name alone made a BLT's lettuce
 * cost $3.12. No charge group on the item → its options pass through untouched. */
export function withToppingCharges(categories: MenuCategory[]): MenuCategory[] {
  return categories.map((cat) => ({
    ...cat,
    blurb: fixBlurb(cat.blurb),
    items: cat.items.map((item: MenuItem) => {
      if (!item.options?.length) return item;
      if (!item.options.some(isToppingChargeGroup)) return item;
      const options = item.options
        .filter((g: OptionGroup) => !isToppingChargeGroup(g))
        .map((g: OptionGroup) =>
          !isToppingsGroup(g.group)
            ? g
            : {
                ...g,
                choices: g.choices.map((c: OptionChoice) =>
                  // A topping that already carries its own Clover price (Penne Pasta
                  // $1.04) keeps it — that one is priced as a modifier, not by the
                  // charge group, and adding both would overcharge.
                  c.delta ? c : { ...c, delta: display(TOPPING_CHARGE_CENTS) },
                ),
              },
        );
      return { ...item, options };
    }),
  }));
}
