import assert from "node:assert/strict";
import test from "node:test";
import { uniquifyLineNames } from "../api/lib/lineNames.ts";

// Measured 2026-08-29 at the Sea Bright sibling (live draft-order probe): Clover's ecommerce
// mirror deduplicates line items by NAME and never converges, so any cart with a repeated
// name read back short by whole items, failed getEcommOrderAmount's equality check, and split
// into the two-order fallback — correct charge, POS ticket stuck OPEN. Duplicate names must
// never reach Clover; createDraftOrder runs every order's items through this.

test("a multi-quantity cart becomes unique names", () => {
  const items = [{ name: "Plain Pizza" }, { name: "Plain Pizza" }, { name: "Plain Pizza" }];
  uniquifyLineNames(items);
  assert.deepEqual(items.map((i) => i.name), ["Plain Pizza", "Plain Pizza #2", "Plain Pizza #3"]);
});

test("same item twice with different options becomes unique names", () => {
  const items = [{ name: "Chicken Parm Hero", price: 1000 }, { name: "Chicken Parm Hero", price: 1300 }];
  uniquifyLineNames(items);
  assert.deepEqual(items.map((i) => i.name), ["Chicken Parm Hero", "Chicken Parm Hero #2"]);
});

test("distinct names are untouched, first occurrence stays bare", () => {
  const items = [{ name: "Plain Pizza" }, { name: "Grandma Pizza" }, { name: "Delivery Fee" }];
  uniquifyLineNames(items);
  assert.deepEqual(items.map((i) => i.name), ["Plain Pizza", "Grandma Pizza", "Delivery Fee"]);
});

test("a 120-char name still gets a readable suffix instead of being dropped", () => {
  const long = "X".repeat(120);
  const items = [{ name: long }, { name: long }];
  uniquifyLineNames(items);
  assert.equal(items[1].name, `${"X".repeat(112)} #2`);
  assert.notEqual(items[0].name, items[1].name);
});

test("the suffix itself cannot recreate a collision", () => {
  // A cart that already contains "Slice #2" alongside two "Slice" lines must still end unique.
  const items = [{ name: "Slice" }, { name: "Slice #2" }, { name: "Slice" }];
  uniquifyLineNames(items);
  assert.equal(new Set(items.map((i) => i.name)).size, items.length, `collision: ${items.map((i) => i.name)}`);
});
