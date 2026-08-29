/**
 * Clover's ecommerce mirror deduplicates line items by NAME and never converges (measured
 * 2026-08-29 at the Sea Bright sibling with a live draft-order probe: two same-named lines
 * surface as one, three surface as one, while the mirror's tax entry still covers everything
 * posted). Any cart with a repeated name therefore reads back short by whole items, fails the
 * getEcommOrderAmount equality check, and splits into the two-order fallback — correct charge,
 * POS ticket stuck OPEN with the payment beside it.
 *
 * A numeric suffix defeats the dedupe (probe-verified: all suffixed lines survive, sum exact),
 * and reads naturally on a kitchen chit. The first occurrence keeps its bare name so the
 * common single-item cart is untouched. Mutates in place; returns the same array.
 */
export function uniquifyLineNames<T extends { name: string }>(items: T[]): T[] {
  // A taken-set rather than a per-name counter: a cart can legitimately contain an item whose
  // REAL name already looks like a suffix ("Slice #2" on the menu next to two plain "Slice"
  // lines), and a bare counter would mint that exact string again — recreating the collision
  // this function exists to prevent.
  const taken = new Set<string>();
  for (const it of items) {
    let candidate = it.name;
    for (let k = 2; taken.has(candidate); k++) candidate = `${it.name.slice(0, 112)} #${k}`;
    it.name = candidate;
    taken.add(candidate);
  }
  return items;
}
