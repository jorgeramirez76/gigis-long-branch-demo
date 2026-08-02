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
import { findCatalogItem, optionDelta, placementEligible, resolveOptionGroup } from "../../src/lib/menuPricing.js";
import { isToppingPlacement, isToppingsGroup, type ToppingPlacement } from "../../src/data/menuToppings.js";

export type ClientLine = {
  itemName: string;
  categoryId?: string;
  options?: { group?: string; name: string; placement?: string }[];
  quantity: number;
  notes?: string;
};

export type PricedLine = {
  itemName: string;
  categoryId: string;
  basePrice: number; // authoritative cents
  /** placement is present on every half-eligible topping ("whole" unless the
   * customer chose a half) so the kitchen ticket can print where each goes. */
  options: { group: string; name: string; delta: number; placement?: ToppingPlacement }[]; // authoritative
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

    const options: { group: string; name: string; delta: number; placement?: ToppingPlacement }[] = [];
    for (const o of line.options ?? []) {
      // The MENU decides which group an option lives in — a crafted or missing
      // group can't relocate Pepperoni off the ticket's topping section.
      const group = resolveOptionGroup(item, o);
      // Placement only survives on options that can actually be halved; a crafted
      // "left" on a side sauce is dropped, never priced, never printed. A topping
      // that can't be halved (Penne Pasta, own price) but sits on a placeable pie
      // is locked to "whole" so the kitchen ticket states it like the rest.
      const eligible = placementEligible(item, { group, name: o.name });
      const placement: ToppingPlacement | undefined = eligible
        ? isToppingPlacement(o.placement) ? o.placement : "whole"
        : isToppingsGroup(group) && item.hasPlaceableToppings ? "whole" : undefined;
      const delta = optionDelta(item, { group, name: o.name, placement: eligible ? placement : undefined });
      if (delta == null) return { ok: false, reason: `Unknown option "${o.name}" on ${line.itemName}` };
      options.push({ group, name: o.name, delta, placement });
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
