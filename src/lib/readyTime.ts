/**
 * Quoted prep time for a website order (owner's rule):
 *   3 items or fewer  → ready in 15 minutes
 *   4 items or more   → ready in 20 minutes
 *
 * "Items" means total units ordered (2 pies = 2 items), not distinct menu lines.
 * Shared by the checkout confirmation popup and the emailed receipt (this file
 * is in tsconfig.api.json) so the customer is never told two different times.
 */

export const READY_BUSY_THRESHOLD_UNITS = 4;
export const READY_MINUTES_SMALL = 15;
export const READY_MINUTES_LARGE = 20;

/** Total units across cart lines. */
export function countUnits(lines: { quantity: number }[]): number {
  return lines.reduce((sum, l) => sum + (l.quantity || 0), 0);
}

export function readyMinutes(units: number): number {
  return units >= READY_BUSY_THRESHOLD_UNITS ? READY_MINUTES_LARGE : READY_MINUTES_SMALL;
}

/** Customer-facing sentence, e.g. "Your order will be ready in about 15 minutes." */
export function readyMessage(units: number, fulfillment: "pickup" | "delivery"): string {
  const mins = readyMinutes(units);
  return fulfillment === "delivery"
    ? `Your order will be ready in about ${mins} minutes, then it heads out for delivery.`
    : `Your order will be ready for pickup in about ${mins} minutes.`;
}
