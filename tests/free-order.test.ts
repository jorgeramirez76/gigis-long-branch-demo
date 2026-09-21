import assert from "node:assert/strict";
import test from "node:test";
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
import { applyFreePie, isFreePickupOrder } from "../api/lib/promo.ts";
import { buildOrderNote, computeTotals, ticketTitle } from "../api/lib/clover.ts";

/**
 * 2026-09-21: a new member whose cart held only the free welcome pie was refused at checkout
 * ("Your total comes to $0.00 — … just come in") and came to the counter angry. A pickup order
 * a promo brings to exactly $0.00 now skips the card step and goes to the kitchen.
 */

const pie = { itemName: "Plain Pie", categoryId: "pizza", basePrice: 1700, options: [], quantity: 1 };
const knots = { itemName: "Garlic Knots", categoryId: "appetizers", basePrice: 600, options: [], quantity: 1 };

test("only the free pie in the cart is a $0.00 pickup order, and that is now a valid order", () => {
  const applied = applyFreePie([pie], "PIE-TEST01")!;
  const totals = computeTotals([pie], 0, 0, applied.discountCents);
  assert.equal(totals.total, 0, "discount, card pricing and tax all net to zero");
  assert.equal(isFreePickupOrder(totals.total, true, "pickup"), true);
});

test("the free path is narrow: a promo, pickup, and exactly $0.00 — nothing else qualifies", () => {
  assert.equal(isFreePickupOrder(0, false, "pickup"), false, "no promo → still an empty order");
  assert.equal(isFreePickupOrder(0, true, "delivery"), false, "delivery never qualifies");
  assert.equal(isFreePickupOrder(1, true, "pickup"), false, "a cent owed is a card order");
  assert.equal(isFreePickupOrder(-5, true, "pickup"), false, "a negative total is never an order");
});

test("adding anything to the free pie turns it back into an ordinary card order", () => {
  const lines = [pie, knots];
  const applied = applyFreePie(lines, "PIE-TEST01")!;
  const totals = computeTotals(lines, 0, 0, applied.discountCents);
  assert.ok(totals.total > 0);
  assert.equal(isFreePickupOrder(totals.total, true, "pickup"), false);
});

test("the kitchen ticket says the order is free, never that it was paid by card or is owed", () => {
  assert.equal(ticketTitle("pickup", "free"), "WEBSITE ORDER • CUSTOMER PICKUP • FREE (VIP)");
  assert.equal(ticketTitle("pickup", true), "WEBSITE ORDER • CUSTOMER PICKUP • PAID w/ CC", "card orders unchanged");
  const applied = applyFreePie([pie], "PIE-TEST01")!;
  const totals = computeTotals([pie], 0, 0, applied.discountCents);
  const note = buildOrderNote({
    fulfillment: "pickup",
    customer: { name: "Test Member", phone: "+17325550100" },
    lines: applied.lines,
    totals,
    payment: "free",
  });
  assert.match(note, /FREE — VIP PROMO, NOTHING OWED/);
  assert.doesNotMatch(note, /PAID w\/ CC|NOT PAID/);
  // 2026-09-21: the note is a HEADER now (see tests/ticket-header.test.ts) — the
  // "FREE — VIP welcome pie" marker rides the LINE ITEM, which is what prints below it.
  assert.match(applied.lines[0].notes ?? "", /FREE — VIP welcome pie PIE-TEST01/, "the free line itself still says it");
  assert.doesNotMatch(note, /welcome pie/, "the header must not repeat the line");
});
