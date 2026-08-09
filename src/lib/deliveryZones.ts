/**
 * Delivery fee schedule — the single source of truth for BOTH the checkout UI and the server.
 *
 * Shared via tsconfig.api (same pattern as readyTime.ts) so the price a customer sees and the price
 * the server charges are computed by the same function. The client NEVER sends a fee amount; it
 * sends the chosen town, and the server recomputes the fee itself. A tampered client can therefore
 * change which town it claims (and the driver sees that town on the ticket) but cannot invent a
 * cheaper fee, and cannot pick a town Gigi's doesn't deliver to.
 *
 * Set by the owner on 2026-07-31: $3 to Long Branch and West Long Branch, $5 to every other town
 * in the delivery area. Long Branch covers its neighbourhoods — West End, Pier Village and
 * Elberon are all Long Branch addresses, so they take the $3 rate.
 */

/** Towns Gigi's delivers to, and the fee in cents. Keys are the exact strings shown in the UI. */
export const DELIVERY_FEES = {
  "Long Branch": 300,
  "West Long Branch": 300,
  "Monmouth Beach": 500,
  Oceanport: 500,
  Eatontown: 500,
  "Tinton Falls": 500,
  Deal: 500,
  Allenhurst: 500,
  "Loch Arbour": 500,
  Oakhurst: 500,
  "Asbury Park": 500,
  Shrewsbury: 500,
} as const;

export type DeliveryTown = keyof typeof DELIVERY_FEES;

/** Ordered for the dropdown: the two $3 towns first, then the rest alphabetically. */
export const DELIVERY_TOWNS = Object.keys(DELIVERY_FEES) as DeliveryTown[];

export function isDeliveryTown(v: unknown): v is DeliveryTown {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(DELIVERY_FEES, v);
}

/**
 * Fee in cents for a delivery order to `town`. Pickup orders pay nothing.
 * Returns null for an unknown town so the caller can reject the order rather than guess — never
 * fall back to a default fee, because that would silently charge the wrong amount.
 */
export function deliveryFeeCents(fulfillment: "pickup" | "delivery", town: unknown): number | null {
  if (fulfillment === "pickup") return 0;
  if (!isDeliveryTown(town)) return null;
  return DELIVERY_FEES[town];
}

/** "$3.00" — for UI labels next to each town in the picker. */
export function formatFee(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
