/** A charge may proceed only when the customer-visible total is an integer cent amount
 * and exactly matches the total recomputed from the server catalog. */
export function clientTotalMatches(expected: unknown, authoritative: number): boolean {
  return Number.isInteger(expected) && expected === authoritative;
}
