import type { MenuCategory } from "../../src/data/menuTypes.js";
import { MENU_PRICING_VERSION } from "./cardPricing.mjs";
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
    const cats = await snapshotCategories();
    if (!cats) return null;
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

/** Read a valid current-format availability snapshot without changing catalog prices. */
export async function snapshotCategories(): Promise<MenuCategory[] | null> {
  try {
    const rows = await sql`SELECT data FROM menu_snapshot WHERE business = 'gigis_long_branch'`;
    const data = rows.rows[0]?.data;
    if (data?.pricing !== MENU_PRICING_VERSION || !Array.isArray(data.categories) || !data.categories.length) return null;
    if (!data.categories.every((c: MenuCategory) => c && typeof c.id === "string" && Array.isArray(c.items) && c.items.every(it => it && typeof it.name === "string"))) return null;
    return data.categories as MenuCategory[];
  } catch (err) {
    console.error("[menuLive] snapshot unavailable", err);
    return null;
  }
}

/** Reject partial pulls even when their total remains superficially plausible.
 * Deliberate shrink overrides cannot bypass the cold-start floor. */
export const MIN_MENU_ITEMS = 300;
export const MAX_REMOVAL_SHARE = 0.25;
export function badPull(fresh: MenuCategory[], baseline: MenuCategory[]): string | null {
  const total = fresh.reduce((count, category) => count + category.items.length, 0);
  if (total < MIN_MENU_ITEMS) return `only ${total} items (min ${MIN_MENU_ITEMS}) — looks wrong`;
  if (process.env.MENU_SYNC_ALLOW_SHRINK === "1") return null;
  const previousTotal = baseline.reduce((count, category) => count + category.items.length, 0);
  if (previousTotal > 0 && total < previousTotal * (1 - MAX_REMOVAL_SHARE)) {
    return `${total} items against ${previousTotal} in the last good menu — over a quarter would disappear`;
  }
  const freshIds = new Set(fresh.filter(category => category.items.length > 0).map(category => category.id));
  const lost = baseline.filter(category => category.items.length > 0 && !freshIds.has(category.id)).map(category => category.id);
  return lost.length ? `these categories would come off the site entirely: ${lost.join(", ")}` : null;
}
