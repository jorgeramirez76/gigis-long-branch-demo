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
import { findCatalogItem, optionDelta } from "../../src/lib/menuPricing.js";

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
 *
 * `available` (from the nightly Clover snapshot — see menuLive.ts) additionally
 * rejects items the shop has taken off Clover since this build's catalog was
 * generated. Omit it, or pass null, to skip that check.
 */
export function priceLines(clientLines: ClientLine[], available?: Set<string> | null): PriceResult {
  const out: PricedLine[] = [];
  for (const line of clientLines) {
    if (available && !available.has(line.itemName)) {
      return { ok: false, reason: `"${line.itemName}" is no longer on the menu — please remove it from your order` };
    }
    const item = findCatalogItem(line.itemName, line.categoryId);
    if (!item) return { ok: false, reason: `Unknown item: ${line.itemName}` };

    const options: { group: string; name: string; delta: number }[] = [];
    for (const o of line.options ?? []) {
      const delta = optionDelta(item, o);
      if (delta == null) return { ok: false, reason: `Unknown option "${o.name}" on ${line.itemName}` };
      options.push({ group: o.group ?? "", name: o.name, delta });
    }

    // Quote-by-call items (e.g. market-price catering) carry no price and would
    // otherwise enter the order at $0 — they must be ordered by phone.
    const unitPrice = item.basePrice + options.reduce((sum, o) => sum + o.delta, 0);
    if (unitPrice <= 0) {
      return { ok: false, reason: `"${line.itemName}" is priced by quote — call (732) 377-2468 to order it` };
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
