/**
 * Buy-one-get-one pizza maths — the ONLY place the free units are chosen.
 *
 * Shared deliberately: the browser previews the discount before submitting and the
 * server derives the authoritative one, and `clientTotalMatches()` in api/order/create.ts
 * rejects the order if the two disagree by a cent. Keeping one implementation (pure, no
 * DB, no catalog import) is what makes that gate safe to leave switched on.
 *
 * Rules, straight off the flyer ("BUY ONE PIZZA GET ONE FREE — ANY PIZZA ON THE MENU"):
 *   - Only items in the Pizza section count. Slices, and the Two Pie Special (already a
 *     two-pie deal, in the Specials section), are not pizzas for this purpose.
 *   - Every 2 qualifying units earn 1 free: 2 pizzas → 1 free, 3 → 1, 4 → 2.
 *   - The free one is the cheaper of each pair, which is what "get one free" means
 *     everywhere and is the reading that cannot lose the shop money by surprise.
 *   - Only the BASE price comes off. A topped pizza can be the free one, but its toppings
 *     stay charged — the same rule the welcome free pie has always used (api/lib/promo.ts).
 */

/** The menu section whose items count as "a pizza". Matches the category id in
 *  src/data/menuGenerated.ts — specialty pies live here, slices do not. */
export const PIZZA_CATEGORY_ID = "pizza";

export type BogoLine = {
  itemName: string;
  categoryId?: string;
  basePrice: number;
  options: { delta: number }[];
  quantity: number;
};

export type BogoPlan = {
  /** How many units of each input line are free, keyed by that line's index. */
  freeByIndex: number[];
  /** Sum of the base prices going free — the discount, in cents. */
  discountCents: number;
  /** Total free units. 0 means the cart has fewer than two qualifying pizzas. */
  freeCount: number;
  /** Qualifying pizza units in the cart, free ones included. */
  pizzaUnits: number;
};

const EMPTY = (n: number): BogoPlan => ({
  freeByIndex: new Array(n).fill(0),
  discountCents: 0,
  freeCount: 0,
  pizzaUnits: 0,
});

/**
 * Decide which pizza units are free. Pure and deterministic: identical input order in,
 * identical plan out, on both sides of the wire.
 */
export function planBogoPizza(lines: readonly BogoLine[]): BogoPlan {
  if (!Array.isArray(lines) || lines.length === 0) return EMPTY(0);

  type Unit = { index: number; basePrice: number; topped: boolean };
  const units: Unit[] = [];
  lines.forEach((line, index) => {
    if (line?.categoryId !== PIZZA_CATEGORY_ID) return;
    const quantity = Math.max(0, Math.floor(Number(line.quantity) || 0));
    const basePrice = Math.max(0, Math.round(Number(line.basePrice) || 0));
    const topped = Array.isArray(line.options) && line.options.length > 0;
    for (let n = 0; n < quantity; n++) units.push({ index, basePrice, topped });
  });

  const plan = EMPTY(lines.length);
  plan.pizzaUnits = units.length;
  if (units.length < 2) return plan;

  // Most expensive first, so pairing off the sorted list always leaves the CHEAPER unit of
  // each pair in the free slot. Ties put the topped unit in the paying slot (its toppings
  // are charged either way, so freeing the plain one prints a cleaner ticket for the same
  // money), then original position — never anything that could differ between two runs.
  const order = units
    .map((unit, seq) => ({ unit, seq }))
    .sort((a, b) =>
      b.unit.basePrice - a.unit.basePrice ||
      Number(b.unit.topped) - Number(a.unit.topped) ||
      a.seq - b.seq,
    );

  // Sorted descending, the odd positions are the second item of each pair: the free ones.
  for (let position = 1; position < order.length; position += 2) {
    const { unit } = order[position];
    plan.freeByIndex[unit.index] += 1;
    plan.discountCents += unit.basePrice;
    plan.freeCount += 1;
  }
  return plan;
}
