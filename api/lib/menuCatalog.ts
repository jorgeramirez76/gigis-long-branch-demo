/**
 * Server-side authoritative price catalog.
 *
 * SECURITY: the browser must never set prices. The client sends item/option
 * identifiers (name + category id + option group/name) and quantities; this
 * module looks up the REAL price from the same generated menu the POS is built
 * from, ignores any client-sent basePrice/delta, and rejects unknown
 * items/options. Without this, a customer could edit the request and pay a
 * penny for a full order.
 *
 * Built from src/data/menuGenerated.ts (type-only imports → safe to bundle into
 * a serverless function; no runtime deps travel with it).
 */
import { MENU_GENERATED } from "../../src/data/menuGenerated.js";

const SEP = "\u0000"; // NUL separator — collision-free (ids/names never contain it)

/** Parse a display price ("$17.68" / "+$1.04") to integer cents. Mirrors the client's parsePrice. */
function parsePrice(display?: string | null): number {
  if (!display) return 0;
  const m = display.replace(/[^0-9.]/g, "");
  if (!m) return 0;
  return Math.round(parseFloat(m) * 100);
}

type CatalogItem = {
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

function catalog() {
  if (!byCatItem || !byItemName) build();
  return { byCatItem: byCatItem!, byItemName: byItemName! };
}

export type ClientLine = {
  itemName: string;
  categoryId?: string;
  options?: { group?: string; name: string }[];
  quantity: number;
  notes?: string;
};

export type PricedLine = {
  itemName: string;
  categoryId: string;
  basePrice: number; // authoritative cents
  options: { group: string; name: string; delta: number }[]; // authoritative
  quantity: number;
  notes?: string;
};

export type PriceResult = { ok: true; lines: PricedLine[] } | { ok: false; reason: string };

/**
 * Re-price client lines against the trusted catalog. Returns authoritative
 * lines, or a rejection if any item/option is unknown. Client-sent prices are
 * never used.
 */
export function priceLines(clientLines: ClientLine[]): PriceResult {
  const { byCatItem, byItemName } = catalog();
  const out: PricedLine[] = [];
  for (const line of clientLines) {
    const item =
      (line.categoryId != null ? byCatItem.get(line.categoryId + SEP + line.itemName) : undefined) ||
      byItemName.get(line.itemName) ||
      undefined;
    if (!item) return { ok: false, reason: `Unknown item: ${line.itemName}` };

    const options: { group: string; name: string; delta: number }[] = [];
    for (const o of line.options ?? []) {
      let delta: number | undefined;
      if (o.group) delta = item.optByGroupName.get(o.group + SEP + o.name);
      if (delta == null) {
        const byName = item.optByName.get(o.name);
        delta = byName != null && !Number.isNaN(byName) ? byName : undefined;
      }
      if (delta == null) return { ok: false, reason: `Unknown option "${o.name}" on ${line.itemName}` };
      options.push({ group: o.group ?? "", name: o.name, delta });
    }

    out.push({
      itemName: line.itemName,
      categoryId: line.categoryId ?? "",
      basePrice: item.basePrice,
      options,
      quantity: line.quantity,
      notes: line.notes,
    });
  }
  return { ok: true, lines: out };
}
