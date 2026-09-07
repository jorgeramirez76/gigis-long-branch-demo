/**
 * Nightly Clover → website menu reconciliation.
 *
 * READ-ONLY toward Clover. This module only ever issues GETs against the
 * inventory endpoints: the POS is the source of truth, the website follows it.
 * Nothing here (and nothing in the cron that calls it) creates, updates, or
 * re-adds an item in Clover — if the owner takes something off the POS it stays
 * off, and the site drops it.
 *
 * What counts as "taken off Clover":
 *   • the item no longer exists (deleted from inventory)
 *   • it is hidden
 *   • it is marked unavailable
 *   • it is stock-tracked and the count is 0 (86'd)
 *
 * Matching is by Clover ITEM ID (src/data/menuIndex.ts), never by name, so
 * renaming an item in Clover can't knock it off the site. A site row whose id
 * we can't verify is always kept — unverifiable is not "gone".
 */
import { menuPriceCents } from "./cardPricing.mjs";
import { MENU_PRICED } from "../../src/data/menuPriced.js";
import { MENU_INDEX } from "../../src/data/menuIndex.js";
import type { MenuCategory } from "../../src/data/menuTypes.js";

const REST_BASE = "https://api.clover.com";

/** Above this share of the menu, a mass "removal" is treated as a bad pull
 * (token scope change, partial API outage) rather than a real menu change. */
const MAX_REMOVAL_SHARE = 0.25;

type LiveItem = {
  id: string;
  name?: string;
  price?: number;
  hidden?: boolean;
  available?: boolean;
  deleted?: boolean;
};

export type LiveInventory = {
  /** Every item id Clover returned. */
  known: Set<string>;
  /** Ids that are still orderable (not hidden / unavailable / deleted / 86'd). */
  sellable: Set<string>;
  priceById: Map<string, number>;
  /** Ids dropped purely because their tracked stock is 0. */
  outOfStock: Set<string>;
  /** True when stock counts looked unmaintained and were ignored wholesale. */
  stockIgnored: boolean;
  /** Live price of Clover's "$ TOPPING $" → "Full Topping", or null if that group
   *  has gone. The site folds this into each topping (src/data/menuToppings.ts);
   *  if the shop repriced it in Clover, the two have to be reconciled by hand —
   *  the order API charges from the constant, so this is reported, never applied. */
  toppingChargeCents: number | null;
  /** Same for "1st Half"/"2nd Half" — the half-pie rate the site charges for a
   *  left/right topping. Null if absent; the max of the two if they differ. */
  halfToppingChargeCents: number | null;
};

async function page(mid: string, token: string, path: string, expand?: string): Promise<any[]> {
  const out: any[] = [];
  for (let off = 0; off < 5000; off += 500) {
    const res = await fetch(`${REST_BASE}/v3/merchants/${mid}/${path}?limit=500&offset=${off}${expand ? `&expand=${expand}` : ""}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`clover_${path}_${res.status}`);
    const data = await res.json();
    const els: any[] = data.elements || [];
    out.push(...els);
    if (els.length < 500) break;
  }
  return out;
}

/** Pull the live inventory + stock counts. GET only. */
export async function fetchLiveInventory(): Promise<LiveInventory> {
  const token = process.env.CLOVER_API_TOKEN;
  const mid = process.env.CLOVER_MERCHANT_ID;
  if (!token || !mid) throw new Error("clover_not_configured");

  const [items, stocks, mgroups] = await Promise.all([
    page(mid, token, "items") as Promise<LiveItem[]>,
    // Stock tracking is optional per item; merchants that don't use it return
    // nothing here, which makes the 86 check silently inert.
    page(mid, token, "item_stocks").catch(() => [] as any[]),
    page(mid, token, "modifier_groups", "modifiers").catch(() => [] as any[]),
  ]);

  const chargeGroup = mgroups.find((g: any) => g?.name === "$ TOPPING $");
  const chargeMods = chargeGroup?.modifiers?.elements || [];
  const fullTopping = chargeMods.find((m: any) => /^full topping$/i.test(m?.name || ""));
  const toppingChargeCents = typeof fullTopping?.price === "number" ? fullTopping.price : null;
  const halves = chargeMods
    .filter((m: any) => /^(1st|2nd) half$/i.test(m?.name || ""))
    .map((m: any) => m.price)
    .filter((p: unknown): p is number => typeof p === "number");
  const halfToppingChargeCents = halves.length ? Math.max(...halves) : null;

  const known = new Set<string>();
  const priceById = new Map<string, number>();
  const live = new Map<string, LiveItem>();
  for (const it of items) {
    if (!it?.id) continue;
    known.add(it.id);
    live.set(it.id, it);
    if (typeof it.price === "number") priceById.set(it.id, it.price);
  }

  const outOfStock = new Set<string>();
  for (const s of stocks) {
    const id = s?.item?.id ?? s?.itemId;
    if (!id || !known.has(id)) continue;
    if (typeof s.quantity === "number" && s.quantity <= 0) outOfStock.add(id);
  }
  // A shop that switched tracking on and never counted would zero out its whole
  // menu. If that's what the numbers look like, ignore the stock signal entirely.
  const stockIgnored = known.size > 0 && outOfStock.size > known.size * MAX_REMOVAL_SHARE;
  if (stockIgnored) outOfStock.clear();

  const sellable = new Set<string>();
  for (const [id, it] of live) {
    if (it.deleted) continue;
    if (it.hidden) continue;
    if (it.available === false) continue;
    if (outOfStock.has(id)) continue;
    sellable.add(id);
  }

  return { known, sellable, priceById, outOfStock, stockIgnored, toppingChargeCents, halfToppingChargeCents };
}

export type PruneResult = {
  categories: MenuCategory[];
  total: number;
  removed: string[];
  /** Items whose Clover price no longer matches the site — reported, not applied
   * (the order API prices from the same static catalog, so a silent change here
   * would make the site quote one price and charge another). */
  priceDrift: { item: string; site: string; clover: string }[];
};

const key = (cat: string, name: string) => `${cat}\u0000${name}`;
const INDEX = new Map(MENU_INDEX.map((e) => [key(e.cat, e.name), e.ids]));

/** Apply the live inventory to the built menu: drop what Clover no longer sells. */
export function pruneMenu(inv: LiveInventory): PruneResult {
  const removed: string[] = [];
  const priceDrift: { item: string; site: string; clover: string }[] = [];
  let total = 0;

  const categories: MenuCategory[] = [];
  for (const cat of MENU_PRICED) {
    const items = cat.items.filter((it: (typeof cat.items)[number]) => {
      total++;
      const ids = INDEX.get(key(cat.id, it.name));
      if (!ids || ids.length === 0) return true; // unmapped row — never pruned
      if (ids.some((id) => inv.sellable.has(id))) {
        const sellableId = ids.find((id) => inv.sellable.has(id))!;
        // The register price carries the cash-discount program's 4%; the site shows cash prices,
        // so the comparison is made on the same footing (api/lib/cardPricing.mjs).
        const register = inv.priceById.get(sellableId);
        const clover = typeof register === "number" ? menuPriceCents(register) : register;
        const site = Math.round(parseFloat((it.price || "").replace(/[^0-9.]/g, "")) * 100);
        if (clover != null && site > 0 && clover !== site) {
          priceDrift.push({
            item: `${cat.name} :: ${it.name}`,
            site: `$${(site / 100).toFixed(2)}`,
            clover: `$${(clover / 100).toFixed(2)}`,
          });
        }
        return true;
      }
      // Every id behind this row is gone or switched off in Clover.
      const why = ids.every((id) => !inv.known.has(id))
        ? "deleted"
        : ids.some((id) => inv.outOfStock.has(id))
          ? "out of stock"
          : "hidden/unavailable";
      removed.push(`${cat.name} :: ${it.name} (${why})`);
      return false;
    });
    if (items.length) categories.push({ ...cat, items });
  }

  return { categories, total, removed, priceDrift };
}

export const REMOVAL_GUARD_SHARE = MAX_REMOVAL_SHARE;
