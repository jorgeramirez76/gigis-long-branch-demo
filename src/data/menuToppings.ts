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
 * Half-pie toppings ($2.08 a side) are NOT orderable online as a result — a
 * half-and-half order has to be phoned in. Expressing "pepperoni on the left" needs
 * per-topping placement in the item modal and a cart line that can carry it; until
 * that exists, charging whole-pie is the honest option, because the alternative
 * shipped so far was charging nothing.
 */

/** Group names as they appear in the generated menu (mapped from Clover in data/clover/sync-config.json). */
export const TOPPING_GROUP = "Toppings";
export const TOPPING_CHARGE_GROUP = "Topping Charges (Whole / Half Pie)";

/** Clover group "$ TOPPING $" → "Full Topping". The nightly refresh re-checks this
 *  against the live POS and reports a mismatch rather than silently repricing. */
export const TOPPING_CHARGE_CENTS = 312;

const display = (cents: number) => `+$${(cents / 100).toFixed(2)}`;

/** The pizza blurb promises half-pie options this removes from the site. */
function fixBlurb(blurb?: string): string | undefined {
  return blurb?.replace(
    "Toppings and half-pie options under each pie.",
    "Toppings are priced per pie — for half-and-half, give us a call.",
  );
}

/** Price every topping, and remove the staff-facing charge group. */
export function withToppingCharges(categories: MenuCategory[]): MenuCategory[] {
  return categories.map((cat) => ({
    ...cat,
    blurb: fixBlurb(cat.blurb),
    items: cat.items.map((item: MenuItem) => {
      if (!item.options?.length) return item;
      const options = item.options
        .filter((g: OptionGroup) => g.group !== TOPPING_CHARGE_GROUP)
        .map((g: OptionGroup) =>
          g.group !== TOPPING_GROUP
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
