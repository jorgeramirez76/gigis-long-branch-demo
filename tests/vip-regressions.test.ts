import assert from "node:assert/strict";
import test from "node:test";
import { addressDedupeKey } from "../api/lib/address.ts";
import { validateVipConsentAndLocality } from "../api/lib/vipValidation.ts";

test("household keys include locality", () => {
  assert.notEqual(
    addressDedupeKey("10 Main St", "2", "Long Branch", "NJ", "07740"),
    addressDedupeKey("10 Main St", "2", "Red Bank", "NJ", "07701"),
  );
});

test("VIP consent must be literal booleans and locality must be complete", () => {
  assert.equal(validateVipConsentAndLocality("false", false, "Long Branch", "NJ", "07740").ok, false);
  assert.equal(validateVipConsentAndLocality(false, false, "Long Branch", "NJ", "07740").ok, false);
  assert.equal(validateVipConsentAndLocality(true, false, "", "NJ", "07740").ok, false);
  assert.equal(validateVipConsentAndLocality(true, false, "Long Branch", "NJ", "07740").ok, true);
});
