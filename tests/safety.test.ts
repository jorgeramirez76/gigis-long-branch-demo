import assert from "node:assert/strict";
import test from "node:test";
import { adminTokenMatches, secretMatches } from "../api/lib/adminAuthToken.ts";
import { normalizeBroadcastPromoCode } from "../api/lib/broadcastPromo.ts";
import { clientTotalMatches } from "../api/lib/orderSafety.ts";

test("a charge is allowed only for the exact customer-visible total", () => {
  assert.equal(clientTotalMatches(1885, 1885), true);
  assert.equal(clientTotalMatches(1885, 2094), false);
  assert.equal(clientTotalMatches(undefined, 1885), false);
  assert.equal(clientTotalMatches(1885.5, 1885.5), false);
});

test("admin token comparison accepts the owner token and safely rejects malformed input", () => {
  assert.equal(adminTokenMatches("owner-secret", "owner-secret"), true);
  assert.equal(adminTokenMatches("wrong-secret", "owner-secret"), false);
  assert.equal(adminTokenMatches("💥", "aa"), false);
  assert.equal(adminTokenMatches(undefined, "owner-secret"), false);
  assert.equal(secretMatches("webhook-secret", "webhook-secret"), true);
  assert.equal(secretMatches("💥", "aa"), false);
});

test("broadcast offers cannot collide with one-time welcome-pie codes", () => {
  assert.equal(normalizeBroadcastPromoCode("gameday30"), "GAMEDAY30");
  assert.equal(normalizeBroadcastPromoCode(" WEEKEND-20 "), "WEEKEND-20");
  assert.equal(normalizeBroadcastPromoCode("PIE-ABCDEF"), null);
  assert.equal(normalizeBroadcastPromoCode("PIEABCDEF"), null);
  assert.equal(normalizeBroadcastPromoCode("bad code"), null);
  assert.equal(normalizeBroadcastPromoCode("x"), null);
});
