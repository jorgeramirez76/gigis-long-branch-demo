import assert from "node:assert/strict";
import test from "node:test";

// The API promo modules pull in the DB client at import time; a placeholder URL keeps that
// import inert. Nothing here touches the network.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

import { planBogoPizza, PIZZA_CATEGORY_ID } from "../src/lib/bogoPromo.ts";
import { applyBogoPizza, normalizeCampaignCode } from "../api/lib/campaignPromo.ts";
import { computeTotals, unitPrice, type CartLineInput } from "../api/lib/clover.ts";

type Line = CartLineInput & { categoryId?: string };

const pie = (name: string, basePrice: number, quantity = 1, options: { group: string; name: string; delta: number }[] = []): Line =>
  ({ itemName: name, categoryId: PIZZA_CATEGORY_ID, basePrice, options, quantity });
const other = (name: string, basePrice: number, categoryId: string, quantity = 1): Line =>
  ({ itemName: name, categoryId, basePrice, options: [], quantity });

const sum = (lines: CartLineInput[]) => lines.reduce((s, l) => s + unitPrice(l) * l.quantity, 0);

test("campaign code normalisation: staff words only, PIE namespace reserved", () => {
  assert.equal(normalizeCampaignCode("gameday"), "GAMEDAY");
  assert.equal(normalizeCampaignCode("  Game Day "), "GAMEDAY");
  assert.equal(normalizeCampaignCode("GAME-DAY"), "GAME-DAY");
  assert.equal(normalizeCampaignCode("PIE-ABC123"), null);
  assert.equal(normalizeCampaignCode("pieday"), null);
  assert.equal(normalizeCampaignCode("abc"), null);
  assert.equal(normalizeCampaignCode("-lead"), null);
  assert.equal(normalizeCampaignCode(""), null);
  assert.equal(normalizeCampaignCode(42), null);
});

test("fewer than two pizzas earns nothing — it is a free pizza, not money off", () => {
  assert.equal(planBogoPizza([]).freeCount, 0);
  assert.equal(planBogoPizza([pie("Plain Pie", 1700)]).freeCount, 0);
  assert.equal(planBogoPizza([pie("Plain Pie", 1700), other("Plain", 330, "slices"), other("Chili Dog", 1099, "hot-dogs")]).freeCount, 0);
  assert.equal(applyBogoPizza([pie("Plain Pie", 1700)], "GAMEDAY"), null);
});

test("only the Pizza section counts: slices and the Two Pie Special are not pizzas here", () => {
  const plan = planBogoPizza([
    other("Plain", 330, "slices", 4),
    other("Two Pie Special", 2800, "special"),
    pie("Plain Pie", 1700),
  ]);
  assert.equal(plan.pizzaUnits, 1);
  assert.equal(plan.freeCount, 0);
});

test("two pizzas: the cheaper one is free, at its base price", () => {
  const plan = planBogoPizza([pie("Sicilian", 2600), pie("Plain Pie", 1700)]);
  assert.equal(plan.freeCount, 1);
  assert.equal(plan.discountCents, 1700);
  assert.deepEqual(plan.freeByIndex, [0, 1]);
});

test("pairs: 3 pizzas → 1 free, 4 → 2, 5 → 2; always the cheaper of each pair", () => {
  const three = planBogoPizza([pie("Sicilian", 2600), pie("Plain Pie", 1700), pie("Margherita", 2200)]);
  assert.equal(three.freeCount, 1);
  assert.equal(three.discountCents, 2200); // 2600 pairs with 2200; 1700 is the odd one out and PAID
  const four = planBogoPizza([pie("Sicilian", 2600), pie("Plain Pie", 1700), pie("Margherita", 2200), pie("White Pie", 2200)]);
  assert.equal(four.freeCount, 2);
  assert.equal(four.discountCents, 2200 + 1700);
  const five = planBogoPizza([pie("Plain Pie", 1700, 5)]);
  assert.equal(five.freeCount, 2);
  assert.equal(five.discountCents, 3400);
});

test("a topped pizza can be the free one, but only its BASE price comes off — toppings stay charged", () => {
  const topped = pie("Plain Pie", 1700, 1, [{ group: "Toppings", name: "Pepperoni", delta: 300 }]);
  const applied = applyBogoPizza([topped, pie("Sicilian", 2600)], "GAMEDAY")!;
  assert.equal(applied.discountCents, 1700);
  const free = applied.lines.find((l) => l.basePrice === 0)!;
  assert.equal(free.itemName, "Plain Pie");
  assert.equal(free.options.length, 1, "topping survives on the free line");
  assert.equal(unitPrice(free), 300, "the free line still charges its topping");
  assert.match(free.notes ?? "", /^FREE — BOGO GAMEDAY/);
});

test("on a price tie the plain one goes free, so the ticket is cleaner for the same money", () => {
  const topped = pie("Plain Pie", 1700, 1, [{ group: "Toppings", name: "Sausage", delta: 300 }]);
  const plain = pie("Plain Pie", 1700);
  const plan = planBogoPizza([topped, plain]);
  assert.deepEqual(plan.freeByIndex, [0, 1]);
  assert.equal(plan.discountCents, 1700);
});

test("a qty>1 line splits into a free part and a full-price remainder; nothing else moves", () => {
  const lines: Line[] = [other("Garlic Knots", 650, "appetizers"), pie("Plain Pie", 1700, 3), other("Coke", 250, "drinks")];
  const applied = applyBogoPizza(lines, "GAMEDAY")!;
  assert.equal(applied.freeCount, 1);
  assert.equal(applied.discountCents, 1700);
  assert.deepEqual(
    applied.lines.map((l) => [l.itemName, l.basePrice, l.quantity]),
    [["Garlic Knots", 650, 1], ["Plain Pie", 0, 1], ["Plain Pie", 1700, 2], ["Coke", 250, 1]],
  );
});

test("the two views agree by construction: sum(kitchenLines) = subtotal − discount", () => {
  const carts: Line[][] = [
    [pie("Sicilian", 2600), pie("Plain Pie", 1700)],
    [pie("Plain Pie", 1700, 5), other("Coke", 250, "drinks", 2)],
    [pie("Plain Pie", 1700, 1, [{ group: "Toppings", name: "Pepperoni", delta: 300 }]), pie("Margherita", 2200), pie("White Pie", 2200, 2)],
  ];
  for (const lines of carts) {
    const applied = applyBogoPizza(lines, "GAMEDAY")!;
    assert.equal(sum(applied.lines), sum(lines) - applied.discountCents);
  }
});

test("totals: tax and card pricing follow the discounted food; tip and fee untouched; Clover amount = total − tip", () => {
  const lines: Line[] = [pie("Sicilian", 2600), pie("Plain Pie", 1700)];
  const applied = applyBogoPizza(lines, "GAMEDAY")!;
  const totals = computeTotals(lines, 500, 0, applied.discountCents);
  assert.equal(totals.subtotal, 4300);
  assert.equal(totals.discount, 1700);
  const paidFood = 4300 - 1700;
  assert.equal(totals.cardPricing, Math.round(paidFood * 0.04));
  assert.equal(totals.tax, Math.round((paidFood + totals.cardPricing) * 0.06625));
  assert.equal(totals.tip, 500);
  assert.equal(totals.total, paidFood + totals.cardPricing + totals.tax + 500);
  // What Clover computes from the zero-priced kitchen lines must equal what we charge, tip aside.
  const kitchen = computeTotals(applied.lines, 0, 0, 0);
  assert.equal(kitchen.total, totals.total - totals.tip);
});

test("deterministic: the same cart in the same order always yields the same plan (browser and server agree)", () => {
  const lines: Line[] = [pie("White Pie", 2200), pie("Plain Pie", 1700, 2), pie("Margherita", 2200), pie("Grandma", 2500)];
  const a = planBogoPizza(lines);
  const b = planBogoPizza(lines.map((l) => ({ ...l })));
  assert.deepEqual(a, b);
  assert.equal(a.freeCount, 2);
  assert.equal(a.discountCents, 2200 + 1700);
});

test("garbage quantities and prices are tolerated, never negative", () => {
  const plan = planBogoPizza([
    { itemName: "Plain Pie", categoryId: PIZZA_CATEGORY_ID, basePrice: -5, options: [], quantity: 2 },
    { itemName: "Sicilian", categoryId: PIZZA_CATEGORY_ID, basePrice: 2600, options: [], quantity: Number.NaN },
  ]);
  assert.equal(plan.freeCount, 1);
  assert.equal(plan.discountCents, 0);
});
