/**
 * Canonical key for de-duplicating a physical address for the one-per-address
 * free-pie welcome promo.
 *
 * Rule (owner): the same address cannot claim the promo twice UNLESS it's a
 * different apartment/unit number. So the key folds street + apt into one
 * normalized string — same street AND same unit ⇒ same key ⇒ blocked; a
 * different unit ⇒ different key ⇒ allowed.
 *
 * Best-effort normalization (lowercase, strip punctuation, drop unit filler
 * words like "apt"/"unit"/"#", standardize common street suffixes) so trivial
 * formatting differences ("140 Brighton Avenue, Apt 3B" vs "140 Brighton Ave"
 * + unit "3b") collapse to the same key. This is not USPS-grade verification —
 * a determined abuser can still fabricate a fake unit — but it stops casual
 * reuse without a paid address-validation service.
 */

const STREET_SUFFIX: Record<string, string> = {
  street: "st", str: "st", avenue: "ave", av: "ave", ave: "ave", road: "rd",
  boulevard: "blvd", drive: "dr", lane: "ln", court: "ct", place: "pl",
  terrace: "ter", circle: "cir", parkway: "pkwy", highway: "hwy",
  square: "sq", trail: "trl", way: "way",
};

// Words that only label a unit — dropped so "Apt 3B" and unit "3B" match.
const UNIT_FILLER = /\b(apartment|apt|unit|suite|ste|number|no|num|room|rm|floor|fl|bldg|building)\b/g;

function normalize(parts: unknown[]): string {
  const combined = parts.map((part) => typeof part === "string" ? part : "").join(" ").toLowerCase();
  const s = combined
    .replace(/[^\w\s]/g, " ") // strip punctuation incl. '#' , '.' , ','
    .replace(UNIT_FILLER, " ")
    .replace(/\b([a-z]+)\b/g, (w) => STREET_SUFFIX[w] ?? w)
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

/** Legacy key used to recognize households created before locality was included. */
export function legacyAddressDedupeKey(street: string, apt?: string | null): string {
  return normalize([street, apt]);
}

/** Combined street+unit+locality key. Empty string if there's no usable street. */
export function addressDedupeKey(
  street: string,
  apt?: string | null,
  city?: string | null,
  state?: string | null,
  zip?: string | null,
): string {
  return normalize([street, apt, city, state, zip]);
}
