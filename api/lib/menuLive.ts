import { sql } from "./db.js";
import { availabilityKey, QUALIFIED_MARKER } from "./menuAvailability.js";

/**
 * Item names in the latest nightly Clover snapshot (api/cron/refresh-menu).
 *
 * The order API prices against the static catalog, which still contains items
 * the shop has since pulled off Clover. A page cached before the refresh can
 * therefore still add one to a cart. This is the checkout-side half of the same
 * rule: if it's off Clover, it can't be ordered.
 *
 * Returns null whenever the snapshot can't be read (no DB, no snapshot yet, any
 * error) — the gate then simply doesn't apply and ordering behaves as before.
 */
export async function liveItemNames(): Promise<Set<string> | null> {
  try {
    const rows = await sql`
      SELECT data FROM menu_snapshot WHERE business = 'gigis_long_branch'
    `;
    if (rows.rowCount === 0) return null;
    const cats = rows.rows[0]?.data?.categories;
    if (!Array.isArray(cats) || cats.length === 0) return null;
    // Keyed by CATEGORY + name as well as by bare name. Eight item names exist in two categories,
    // and one pair differs in price (Shrimp Oreganata: a $27.04 seafood dinner and a $67.60
    // catering tray). Keyed on the name alone, pulling one of a pair off Clover left the other
    // one's name in the set, so the "no longer on the menu" gate never fired for the item that
    // was actually removed.
    const names = new Set<string>();
    for (const c of cats) {
      for (const it of c.items ?? []) {
        if (!it?.name) continue;
        names.add(it.name);
        if (c.id) names.add(availabilityKey(c.id, it.name));
      }
    }
    // Marks this set as carrying category-qualified keys, so priceLines knows it may demand
    // them. Snapshots written before this existed hold bare names only and stay on the old rule.
    if (names.size) names.add(QUALIFIED_MARKER);
    return names.size ? names : null;
  } catch (err) {
    console.error("[menuLive] snapshot unavailable", err);
    return null;
  }
}
