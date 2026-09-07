/**
 * Card pricing — the one place the 4% lives.
 *
 * HISTORY. The register runs a cash-discount program: every Clover item price has 4% baked in
 * ($17.00 is stored as $17.68, a $1.00 modifier as $1.04) and cash customers get it back at the
 * counter. The website mirrored those register prices verbatim, so the menu read $17.68.
 *
 * NOW (Jorge, 2026-09-06): the menu shows the clean cash price, and one "Card pricing (4%)" line
 * is added at checkout on the food actually paid for. An online order is always paid by card,
 * so for a price that had the 4% baked in the customer is charged exactly what they were charged
 * before — it is presentation that moved, not money.
 *
 * Plain JS, no imports: this is read by the build-time Clover sync (plain node), by the nightly
 * cron (compiled TS), and by the browser bundle. `cardPricing.d.mts` beside it carries the types.
 */

/** 4% — the register's cash-discount rate. */
export const CARD_PRICING_RATE = 0.04;

/** Label shared by the cart, checkout, receipt email and the kitchen ticket. */
export const CARD_PRICING_LABEL = "Card pricing (4%)";

/**
 * Stamped on every menu snapshot and catalog built through menuPriceCents(). A snapshot without
 * it was written by the old classifier and still carries register (4%-inclusive) prices; the
 * readers refuse it and fall back to the committed catalog rather than charge 4% on top of 4%.
 */
export const MENU_PRICING_VERSION = "cash-prices-v1";

/** Card pricing on an amount of food, whole cents, never negative. */
export function cardPricingCents(foodCents) {
  return Math.round(Math.max(0, foodCents || 0) * CARD_PRICING_RATE);
}

/** A price a menu would print without a second thought: whole quarters, or .95 / .99. */
function strongMenuPrice(cents) {
  const last = cents % 100;
  return cents % 25 === 0 || last === 95 || last === 99;
}

/** A price a menu might print: any nickel, or anything ending in 9. */
function weakMenuPrice(cents) {
  return cents % 5 === 0 || cents % 10 === 9;
}

/**
 * The menu (cash) price for a register price that may carry the baked-in 4%.
 *
 * The register was inflated item by item over time, so not every price got the 4% — $1.00 side
 * sauces, the $3.00 / $5.00 topping tiers and the $1.00 side sauces are stored flat. There is no flag
 * on the POS that says which is which, so this decides from the number itself, strongest
 * evidence first:
 *   1. Stripping 4% lands on a price a menu would print ($17.68 → $17.00, $1.04 → $1.00,
 *      $24.95 → $23.99, $4.15/oz → $3.99/oz): that is the cash price.
 *   2. The register price ALREADY reads that way ($22.00, $1.00, $5.00, $13.99): it was never
 *      inflated — keep it.
 *   3. Only the register price reads like a plausible menu price ($3.30, $4.39): keep it.
 *   4. Only the stripped price does ($8.63 → $8.30, $2.44 → $2.35, $23.56 → $22.65): strip.
 *   5. Neither does ($5.37, $10.36): assume the inflation — the pattern on three quarters of
 *      the catalog — and strip ($5.16, $9.96).
 * Where both readings are strong ($26.00 = $25.00 × 1.04, $6.50 = $6.25 × 1.04) rule 1 wins,
 * because Jorge's instruction was that the 4% went on everything.
 *
 * NOT idempotent — applying it twice to a rule-5 price strips 4% again. Apply it exactly once,
 * where a register price enters the site (the Clover classifier), never at read time.
 */
export function menuPriceCents(registerCents) {
  const cents = Math.round(registerCents || 0);
  if (cents <= 0) return cents;
  const stripped = Math.round(cents / (1 + CARD_PRICING_RATE));
  if (strongMenuPrice(stripped)) return stripped;
  if (strongMenuPrice(cents)) return cents;
  if (weakMenuPrice(cents) && !weakMenuPrice(stripped)) return cents;
  return stripped;
}
