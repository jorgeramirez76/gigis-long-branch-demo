import type { ValidatedSignup } from "./vipSignupShared.js";
import type { VipValidation } from "./vipValidation.js";

/** The primitives parseVipJoinWith needs, injected by the caller. A leaf module with
 *  ZERO runtime imports on purpose: the repo's tests run under plain `node
 *  --experimental-strip-types`, which cannot resolve the api tree's `.js` specifiers —
 *  so the logic lives here import-free, and api/order/create.ts binds the real deps. */
export type VipJoinDeps = {
  normalizePhone: (input: string) => string | null;
  addressDedupeKey: (street: string, apt?: string | null, city?: string | null, state?: string | null, zip?: string | null) => string;
  legacyAddressDedupeKey: (street: string, apt?: string | null) => string;
  validateVipConsentAndLocality: (sms: unknown, email: unknown, city: unknown, state: unknown, zip: unknown) => VipValidation;
  canonicalConsentText: string;
};

/**
 * The optional VIP-club opt-in riding on a checkout ("join the club" box next to
 * the contact fields). Parsed into the SAME ValidatedSignup shape the public form
 * endpoint produces, under the same rules — the pinned consent text attested, the
 * locality validator satisfied (Long Branch households dedupe on
 * street+apt+city+state+zip), and the 5-arg key + legacy key both computed so the
 * one-pie-per-household guarantee matches the signup path exactly.
 *
 * Delivery orders reuse the order's own street + town; the opt-in adds ZIP.
 * Pickup opt-ins supply street/apt/city/ZIP. State is fixed "NJ" — this is a
 * Long Branch pizzeria's checkout, not a national address form.
 *
 * Returns null for anything invalid or absent: the opt-in is a passenger, so a
 * bad block is DROPPED (the confirmation screen's fallback form takes over)
 * rather than ever failing the order. Exported for tests — pure, no I/O.
 */
export function parseVipJoinWith(
  deps: VipJoinDeps,
  vip: unknown,
  cust: { name: string; phone: string; email?: string; address?: string; town?: string },
  fulfillment: "pickup" | "delivery",
): ValidatedSignup | null {
  if (!vip || typeof vip !== "object") return null;
  const v = vip as {
    smsConsent?: unknown;
    emailConsent?: unknown;
    address?: unknown;
    apt?: unknown;
    city?: unknown;
    zip?: unknown;
    consentText?: unknown;
  };
  // Same attestation rule as api/vip-signup.ts: a stale cached bundle showing old
  // wording must never produce a consent record claiming otherwise.
  if (v.consentText !== deps.canonicalConsentText) return null;

  const city = fulfillment === "delivery" ? cust.town : typeof v.city === "string" ? v.city : "";
  const locality = deps.validateVipConsentAndLocality(
    v.smsConsent === true,
    v.emailConsent === true,
    city,
    "NJ",
    typeof v.zip === "string" ? v.zip : "",
  );
  if (!locality.ok) return null;

  const phone = deps.normalizePhone(cust.phone);
  if (!phone) return null;
  const email = cust.email?.trim().toLowerCase();
  if (!email) return null;

  const street = (fulfillment === "delivery" ? cust.address : typeof v.address === "string" ? v.address : "")?.trim().slice(0, 160) ?? "";
  const apt = fulfillment === "pickup" && typeof v.apt === "string" ? v.apt.trim().slice(0, 40) : "";
  if (street.length < 4) return null;
  const addrKey = deps.addressDedupeKey(street, apt, locality.city, locality.state, locality.zip);
  const legacyAddrKey = deps.legacyAddressDedupeKey(street, apt);
  if (!addrKey) return null;

  return {
    name: cust.name,
    phone,
    email,
    fullAddress: [street, locality.city, [locality.state, locality.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    apt: apt || null,
    addrKey,
    legacyAddrKey,
    smsConsent: locality.smsConsent,
    emailConsent: locality.emailConsent,
    source: "checkout",
  };
}
