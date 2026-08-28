import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseVipJoinWith } from "../api/lib/vipCheckoutJoin.ts";
import { addressDedupeKey, legacyAddressDedupeKey } from "../api/lib/address.ts";
import { normalizePhone } from "../api/lib/phone.ts";
import { validateVipConsentAndLocality } from "../api/lib/vipValidation.ts";
// The client copy — byte-identity with the server's CANONICAL_CONSENT_TEXT is pinned below.
import { CONSENT_TEXT } from "../src/lib/vipConsent.ts";

const DEPS = { normalizePhone, addressDedupeKey, legacyAddressDedupeKey, validateVipConsentAndLocality, canonicalConsentText: CONSENT_TEXT };
const parseVipJoin = (vip: unknown, cust: Parameters<typeof parseVipJoinWith>[2], f: "pickup" | "delivery") =>
  parseVipJoinWith(DEPS, vip, cust, f);

const CUST = {
  name: "Jane Tester",
  phone: "(732) 555-0142",
  email: "Jane@Example.com",
  address: "12 Brighton Ave",
  town: "Long Branch",
};

const vip = (over: Record<string, unknown> = {}) => ({
  smsConsent: true,
  emailConsent: false,
  consentText: CONSENT_TEXT,
  zip: "07740",
  ...over,
});

test("checkout opt-in builds the same ValidatedSignup shape the public form produces", () => {
  const out = parseVipJoin(vip({ address: "5 River Rd", apt: "2B", city: "Long Branch" }), CUST, "pickup");
  assert.ok(out);
  assert.equal(out.source, "checkout");
  assert.equal(out.phone, "+17325550142");
  assert.equal(out.email, "jane@example.com");
  assert.equal(out.fullAddress, "5 River Rd, Long Branch, NJ 07740");
  assert.equal(out.apt, "2B");
  // Long Branch households dedupe on the FULL 5-arg key, with the legacy street+apt
  // key alongside — the exact pair the signup path writes. A 2-arg key here would
  // silently fracture the one-pie-per-household guarantee.
  assert.equal(out.addrKey, addressDedupeKey("5 River Rd", "2B", "Long Branch", "NJ", "07740"));
  assert.equal(out.legacyAddrKey, legacyAddressDedupeKey("5 River Rd", "2B"));
});

test("delivery reuses the order's own street and town; the opt-in adds only ZIP", () => {
  const out = parseVipJoin(vip({ address: "999 Should Not Be Used", city: "Nowhere" }), CUST, "delivery");
  assert.ok(out);
  assert.equal(out.fullAddress, "12 Brighton Ave, Long Branch, NJ 07740");
  assert.equal(out.apt, null);
});

test("Long Branch locality rules hold: no ZIP, no signup", () => {
  assert.equal(parseVipJoin(vip({ zip: undefined }), CUST, "delivery"), null);
  assert.equal(parseVipJoin(vip({ zip: "0774" }), CUST, "delivery"), null);
  assert.equal(parseVipJoin(vip({ address: "5 River Rd", city: "", zip: "07740" }), CUST, "pickup"), null);
});

test("consent-text drift is refused — a stale bundle never mints a consent record", () => {
  assert.equal(parseVipJoin(vip({ consentText: "old wording" }), CUST, "delivery"), null);
  assert.equal(parseVipJoin(vip({ consentText: undefined }), CUST, "delivery"), null);
});

test("affirmative boolean consent only — truthy non-booleans do not count", () => {
  assert.equal(parseVipJoin(vip({ smsConsent: false }), CUST, "delivery"), null);
  assert.equal(parseVipJoin(vip({ smsConsent: "yes" }), CUST, "delivery"), null);
  assert.equal(parseVipJoin(vip({ smsConsent: 1 }), CUST, "delivery"), null);
});

test("absent or malformed vip blocks are ignored entirely", () => {
  assert.equal(parseVipJoin(undefined, CUST, "delivery"), null);
  assert.equal(parseVipJoin(null, CUST, "delivery"), null);
  assert.equal(parseVipJoin("join please", CUST, "delivery"), null);
});

test("wiring pins: enrollment only on the success exit, never in the pay gate", () => {
  const createSrc = readFileSync(new URL("../api/order/create.ts", import.meta.url), "utf8");
  const checkoutSrc = readFileSync(new URL("../src/ordering/Checkout.tsx", import.meta.url), "utf8");
  // Exactly one enrollment call — LB has ONE success path; a second call means someone
  // re-added it to an uncertain/not-fired exit where no marketing belongs.
  const calls = createSrc.match(/await startVipEnrollment\(vipJoinReq\)/g) ?? [];
  assert.equal(calls.length, 1);
  // The enrollment leg swallows everything.
  const fn = createSrc.slice(createSrc.indexOf("async function startVipEnrollment"), createSrc.indexOf("export default"));
  assert.match(fn, /try \{/);
  assert.match(fn, /catch \(err\)/);
  // The checkout sends the vip block only when LB-complete (consent + 5-digit ZIP).
  assert.match(checkoutSrc, /\^\\d\{5\}\(\?:-\\d\{4\}\)\?\$/);
  assert.match(checkoutSrc, /consentText: CONSENT_TEXT/);
  // Marketing fields never gate payment: the vip state must not appear in payDisabled logic.
  const gateRegion = checkoutSrc.slice(checkoutSrc.indexOf("const payIsDisabled"), checkoutSrc.indexOf("const payIsDisabled") + 400);
  assert.ok(!/vip/i.test(gateRegion), "vip state leaked into the pay gate");
});

test("client consent copy is byte-identical to the server canonical (source pin)", () => {
  const shared = readFileSync(new URL("../api/lib/vipSignupShared.ts", import.meta.url), "utf8");
  const m = shared.match(/CANONICAL_CONSENT_TEXT =\s*"((?:[^"\\]|\\.)*)"/);
  assert.ok(m, "canonical literal not found");
  const canonical = JSON.parse('"' + m[1] + '"');
  assert.equal(CONSENT_TEXT, canonical, "src/lib/vipConsent.ts drifted from CANONICAL_CONSENT_TEXT");
});
