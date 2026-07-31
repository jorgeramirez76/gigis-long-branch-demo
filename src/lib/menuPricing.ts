/**
 * The single price lookup, shared by the browser and the order API.
 *
 * The server is and stays authoritative — `api/lib/menuCatalog.ts` re-prices every
 * order from this table and ignores whatever the browser sent. The browser needs
 * the same table for a different reason: a cart restored from localStorage carries
 * the prices that were current when the items were added, which may be weeks stale.
 * Re-pricing the cart through this module is what keeps the total a customer is
 * shown equal to the total they are charged. Both sides read one implementation so
 * they cannot drift apart.
 */
// Explicit .js specifier: this module is imported by the serverless functions too,
// where @vercel/node compiles each file to ESM and Node's loader will not resolve an
// extensionless path. Vite maps it back to the .ts source for the browser build.
import { MENU_GENERATED } from "../data/menuGenerated.js";

const SEP = "\u0000"; // NUL separator — collision-free (ids/names never contain it)

/** Parse a display price ("$17.68" / "+$1.04") to integer cents. */
export function parsePrice(display?: string | null): number {
  if (!display) return 0;
  const m = display.replace(/[^0-9.]/g, "");
  if (!m) return 0;
  return Math.round(parseFloat(m) * 100);
}

export type CatalogItem = {
  basePrice: number;
  /** "group\0name" → delta cents (authoritative) */
  optByGroupName: Map<string, number>;
  /** "name" → delta cents, or NaN when the same name maps to different deltas across groups (ambiguous) */
  optByName: Map<string, number>;
};

let byCatItem: Map<string, CatalogItem> | null = null; // "categoryId\0itemName"
let byItemName: Map<string, CatalogItem | null> | null = null; // "itemName" → entry, or null if ambiguous across categories

function build() {
  byCatItem = new Map();
  byItemName = new Map();
  for (const cat of MENU_GENERATED) {
    for (const it of cat.items) {
      const optByGroupName = new Map<string, number>();
      const optByName = new Map<string, number>();
      for (const g of it.options ?? []) {
        for (const c of g.choices) {
          const delta = parsePrice(c.delta);
          optByGroupName.set(g.group + SEP + c.name, delta);
          if (optByName.has(c.name)) {
            if (optByName.get(c.name) !== delta) optByName.set(c.name, NaN); // ambiguous
          } else {
            optByName.set(c.name, delta);
          }
        }
      }
      const entry: CatalogItem = { basePrice: parsePrice(it.price), optByGroupName, optByName };
      byCatItem.set(cat.id + SEP + it.name, entry);
      byItemName.set(it.name, byItemName.has(it.name) ? null : entry);
    }
  }
}

/** The catalog entry for an item, preferring an exact category match. */
export function findCatalogItem(itemName: string, categoryId?: string): CatalogItem | undefined {
  if (!byCatItem || !byItemName) build();
  return (
    (categoryId != null ? byCatItem!.get(categoryId + SEP + itemName) : undefined) ||
    byItemName!.get(itemName) ||
    undefined
  );
}

/** Authoritative upcharge for one chosen option, or undefined if it isn't on the item. */
export function optionDelta(item: CatalogItem, opt: { group?: string; name: string }): number | undefined {
  let delta: number | undefined;
  if (opt.group) delta = item.optByGroupName.get(opt.group + SEP + opt.name);
  if (delta == null) {
    const byName = item.optByName.get(opt.name);
    delta = byName != null && !Number.isNaN(byName) ? byName : undefined;
  }
  return delta;
}
