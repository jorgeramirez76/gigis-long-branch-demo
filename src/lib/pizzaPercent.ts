/**
 * Percent-off-pizza maths — the ONLY place the discount is computed.
 *
 * Shared like bogoPromo.ts: the browser previews it and the server derives the authoritative
 * one, and `clientTotalMatches()` rejects the order if they disagree by a cent.
 *
 * Rules, straight off the flyer ("25% OFF ANY PIZZA — pickup only"):
 *   - Only items in the Pizza section count (same rule as the BOGO).
 *   - The percent comes off the WHOLE pizza — base price plus its toppings — per the owner
 *     (2026-09-25: "calculate the 25% off with pizza and toppings, not just the pizza").
 *   - Rounded per unit, to the cent, so a line of 3 pizzas is exactly 3× one pizza.
 */
import { PIZZA_CATEGORY_ID, type BogoLine } from "./bogoPromo.js";

export type PercentPlan = {
  /** Cents off ONE unit of each input line, keyed by that line's index (0 for non-pizzas). */
  perUnitByIndex: number[];
  /** Total discount in cents. */
  discountCents: number;
  /** Qualifying pizza units in the cart. 0 means nothing to discount. */
  pizzaUnits: number;
};

export function planPizzaPercent(lines: BogoLine[], percentOff: number): PercentPlan {
  const pct = Math.min(100, Math.max(0, Math.round(percentOff)));
  const perUnitByIndex: number[] = [];
  let discountCents = 0;
  let pizzaUnits = 0;
  lines.forEach((line, index) => {
    const qty = Math.max(0, Math.round(line.quantity));
    if (line.categoryId !== PIZZA_CATEGORY_ID || qty < 1 || pct < 1) {
      perUnitByIndex[index] = 0;
      return;
    }
    const unit = Math.round(line.basePrice + line.options.reduce((s, o) => s + Math.round(o.delta || 0), 0));
    const off = Math.max(0, Math.round((unit * pct) / 100));
    perUnitByIndex[index] = off;
    discountCents += off * qty;
    pizzaUnits += qty;
  });
  return { perUnitByIndex, discountCents, pizzaUnits };
}
