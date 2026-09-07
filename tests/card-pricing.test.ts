import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { cardPricingCents, menuPriceCents } from "../api/lib/cardPricing.mjs";
import { HALF_TOPPING_CHARGE_CENTS, TOPPING_CHARGE_CENTS } from "../src/data/menuToppings.ts";

const REGISTER_PRICES = [1768, 104, 312, 208, 2288, 2392, 2495, 2600, 650, 2200, 100, 330, 439, 863, 244, 2356, 537, 1036, 1399, 415, 0];

test("the cash-price rule reads the register the way the menu was typed", () => {
  assert.equal(menuPriceCents(1768), 1700); // Plain Pie
  assert.equal(menuPriceCents(104), 100); // Penne Pasta topping
  assert.equal(menuPriceCents(312), TOPPING_CHARGE_CENTS); // Full Topping
  assert.equal(menuPriceCents(208), HALF_TOPPING_CHARGE_CENTS); // 1st Half
  assert.equal(menuPriceCents(2288), 2200); // White Pie
  assert.equal(menuPriceCents(2495), 2399); // Red Clam Pie
  assert.equal(menuPriceCents(2600), 2500); // both readings clean — the 4% went on everything
  assert.equal(menuPriceCents(100), 100); // Add Ranch — never inflated
  assert.equal(menuPriceCents(2200), 2200);
  assert.equal(menuPriceCents(1399), 1399);
  assert.equal(menuPriceCents(244), 235); // Everything Seed
  assert.equal(menuPriceCents(0), 0);
});

test("a cash price plus 4% card pricing reproduces the register's card price", () => {
  for (const register of [1768, 104, 312, 208, 2288, 2392, 2495, 1144, 1248]) {
    const cash = menuPriceCents(register);
    assert.equal(cash + cardPricingCents(cash), register, `register $${register / 100}`);
  }
});

test("the Python twin the generators use agrees with the JavaScript the order API uses", () => {
  const py = execFileSync("python3", ["scripts/card_pricing.py", ...REGISTER_PRICES.map(String)], { encoding: "utf8" })
    .trim()
    .split(/\s+/)
    .map(Number);
  assert.deepEqual(py, REGISTER_PRICES.map(menuPriceCents));
});

// computeTotals() lives in api/lib/clover.ts, whose CloverError class uses a constructor
// parameter property that Node's strip-only TypeScript mode cannot load, so the totals
// arithmetic is covered by the Sea Bright suite (tests/order-safety.test.ts there), which runs
// the identical implementation.
