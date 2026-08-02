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
import { MENU_PRICED } from "../data/menuPriced.js";
import { TOPPING_CHARGE_CENTS, isToppingsGroup, placementDelta } from "../data/menuToppings.js";

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
  /** "name" → its group, or null when the name appears in several groups. Lets the
   * server put a group-less (or group-spoofed) option back where the menu says it
   * lives, so a crafted request can't move Pepperoni out of the Toppings bucket
   * on the kitchen ticket. */
  groupByName: Map<string, string | null>;
  /** Item carries at least one charge-priced topping → its whole Toppings group
   * prints with placement on the ticket (Penne included, locked to whole pie). */
  hasPlaceableToppings: boolean;
};

let byCatItem: Map<string, CatalogItem> | null = null; // "categoryId\0itemName"
let byItemName: Map<string, CatalogItem | null> | null = null; // "itemName" → entry, or null if ambiguous across categories

function build() {
  byCatItem = new Map();
  byItemName = new Map();
  for (const cat of MENU_PRICED) {
    for (const it of cat.items) {
      const optByGroupName = new Map<string, number>();
      const optByName = new Map<string, number>();
      const groupByName = new Map<string, string | null>();
      let hasPlaceableToppings = false;
      for (const g of it.options ?? []) {
        for (const c of g.choices) {
          const delta = parsePrice(c.delta);
          optByGroupName.set(g.group + SEP + c.name, delta);
          if (optByName.has(c.name)) {
            if (optByName.get(c.name) !== delta) optByName.set(c.name, NaN); // ambiguous
          } else {
            optByName.set(c.name, delta);
          }
          groupByName.set(c.name, groupByName.has(c.name) && groupByName.get(c.name) !== g.group ? null : g.group);
          if (isToppingsGroup(g.group) && delta === TOPPING_CHARGE_CENTS) hasPlaceableToppings = true;
        }
      }
      const entry: CatalogItem = { basePrice: parsePrice(it.price), optByGroupName, optByName, groupByName, hasPlaceableToppings };
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

/** The group this option actually belongs to on the menu. The client's group is
 * trusted only when the menu confirms it; otherwise the option's own (unique)
 * group wins. A spoofed or omitted group can therefore never move an option
 * between ticket sections or dodge topping pricing rules. */
export function resolveOptionGroup(item: CatalogItem, opt: { group?: string; name: string }): string {
  if (opt.group && item.optByGroupName.has(opt.group + SEP + opt.name)) return opt.group;
  return item.groupByName.get(opt.name) ?? opt.group ?? "";
}

/** Authoritative upcharge for one chosen option, or undefined if it isn't on the item.
 * A half-pie topping (placement "left"/"right" on a charge-priced topping in the
 * Toppings group) costs the half rate; placement on anything else is ignored. */
export function optionDelta(item: CatalogItem, opt: { group?: string; name: string; placement?: string }): number | undefined {
  const group = resolveOptionGroup(item, opt);
  let delta = item.optByGroupName.get(group + SEP + opt.name);
  if (delta == null) {
    const byName = item.optByName.get(opt.name);
    delta = byName != null && !Number.isNaN(byName) ? byName : undefined;
  }
  if (delta == null) return undefined;
  return isToppingsGroup(group) ? placementDelta(delta, opt.placement) : delta;
}

/** Whether this option can be placed on half the pie (drives the modal's selector
 * and the server's placement sanitizing — one definition, no drift). */
export function placementEligible(item: CatalogItem, opt: { group?: string; name: string }): boolean {
  const group = resolveOptionGroup(item, opt);
  if (!isToppingsGroup(group)) return false;
  return item.optByGroupName.get(group + SEP + opt.name) === TOPPING_CHARGE_CENTS;
}
