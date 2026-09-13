import test from "node:test";
import assert from "node:assert/strict";
import { badPull, MIN_MENU_ITEMS } from "../api/lib/menuLive.js";
import type { MenuCategory } from "../src/data/menuTypes.js";

const category = (id: string, count: number): MenuCategory => ({
  id, name: id, items: Array.from({ length: count }, (_, i) => ({ name: `${id} ${i}`, price: "$10.00" })),
});

test("menu refresh keeps a plausible complete catalog and modest removals", () => {
  const baseline = [category("pizza", 350), category("sides", 79)];
  assert.equal(badPull(baseline, baseline), null);
  assert.equal(badPull([category("pizza", 310), category("sides", 70)], baseline), null);
});
test("cold start rejects empty and truncated inventories without a prior snapshot", () => {
  assert.match(badPull([], [])!, /only 0 items/);
  assert.match(badPull([category("pizza", MIN_MENU_ITEMS - 1)], [])!, /min 300/);
});
test("loss of a small category is blocked despite a healthy total", () => {
  assert.match(badPull([category("pizza", 410)], [category("pizza", 410), category("breakfast", 19)])!, /breakfast/);
  assert.match(badPull([category("pizza", 410), category("breakfast", 0)], [category("pizza", 410), category("breakfast", 19)])!, /breakfast/);
});
test("a quarter-plus cumulative removal is blocked against the last good snapshot", () => {
  assert.match(badPull([category("pizza", 320)], [category("pizza", 429)])!, /over a quarter/);
});
test("authorized shrink bypasses proportional/category guards but never the absolute floor", () => {
  const previous = process.env.MENU_SYNC_ALLOW_SHRINK;
  process.env.MENU_SYNC_ALLOW_SHRINK = "1";
  try {
    assert.equal(badPull([category("pizza", 320)], [category("pizza", 429), category("sides", 30)]), null);
    assert.match(badPull([category("pizza", 299)], [])!, /min 300/);
  } finally {
    if (previous === undefined) delete process.env.MENU_SYNC_ALLOW_SHRINK;
    else process.env.MENU_SYNC_ALLOW_SHRINK = previous;
  }
});
