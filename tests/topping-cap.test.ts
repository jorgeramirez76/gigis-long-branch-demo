import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  HALF_TOPPING_CHARGE_CENTS,
  TOPPING_CHARGE_CAP_CENTS,
  TOPPING_CHARGE_CENTS,
  capToppingCharges,
} from "../src/data/menuToppings.ts";

// Owner's rule, 2026-09-08: one extra topping is $3, two are $6, and anything past two stays
// at $6. See ORDERING.md "Extra toppings: $3 each, capped at $6 a pie".

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

type Opt = { name: string; delta: number; charge: boolean };
const whole = (name: string): Opt => ({ name, delta: TOPPING_CHARGE_CENTS, charge: true });
const half = (name: string): Opt => ({ name, delta: HALF_TOPPING_CHARGE_CENTS, charge: true });
const own = (name: string, delta: number): Opt => ({ name, delta, charge: false });
const cap = (opts: Opt[]) => capToppingCharges(opts, (o) => o.charge);
const total = (opts: Opt[]) => cap(opts).reduce((s, o) => s + o.delta, 0);

test("owner's schedule: 1 topping $3, 2 toppings $6, 3 through 7 all $6", () => {
  assert.equal(TOPPING_CHARGE_CAP_CENTS, 600);
  assert.equal(TOPPING_CHARGE_CENTS, 300);
  assert.equal(total([whole("Pepperoni")]), 300);
  assert.equal(total([whole("Pepperoni"), whole("Sausage")]), 600);
  for (let n = 3; n <= 7; n++) {
    const opts = Array.from({ length: n }, (_, i) => whole(`Topping ${i + 1}`));
    assert.equal(total(opts), 600, `${n} toppings`);
  }
});

test("the itemized deltas ARE the charge: first two full price, the rest $0", () => {
  const out = cap([whole("A"), whole("B"), whole("C"), whole("D")]);
  assert.deepEqual(out.map((o) => o.delta), [300, 300, 0, 0]);
  assert.deepEqual(out.map((o) => o.name), ["A", "B", "C", "D"]); // order and names untouched
});

test("half-pie toppings count toward the same $6", () => {
  assert.equal(total([half("A"), half("B"), half("C")]), 600);
  assert.equal(total([half("A"), half("B"), half("C"), half("D")]), 600);
  // $3 + $2 + $2 = $7 → the last half is cut to the $1 of room left, never below $0
  assert.deepEqual(cap([whole("A"), half("B"), half("C")]).map((o) => o.delta), [300, 200, 100]);
});

test("a topping with its own Clover price, and every non-topping option, sits outside the cap", () => {
  const opts = [whole("A"), whole("B"), whole("C"), own("Penne Pasta", 100), own("Add Ranch", 100)];
  assert.equal(total(opts), 600 + 100 + 100);
  const out = cap(opts);
  assert.equal(out[3].delta, 100);
  assert.equal(out[4].delta, 100);
});

test("idempotent — a capped line re-caps to itself on every hop (sheet → cart → server)", () => {
  const once = cap([whole("A"), half("B"), half("C"), whole("D")]);
  assert.deepEqual(cap(once), once);
  assert.equal(once.reduce((s, o) => s + o.delta, 0), 600);
});

test("options the cap does not change come back as the same objects", () => {
  const a = whole("A");
  const b = own("Add Ranch", 100);
  const out = cap([a, b]);
  assert.equal(out[0], a);
  assert.equal(out[1], b);
});

test("the cap is wired into every pricing hop, through the catalog's own charge-priced test", () => {
  const pricing = src("../src/lib/menuPricing.ts");
  assert.match(pricing, /capToppingCharges\(options, \(o\) => placementEligible\(item, o\)\)/);
  const catalog = src("../api/lib/menuCatalog.ts");
  assert.match(catalog, /const priced = capLineOptions\(item, options\);/);
  assert.match(catalog, /const unitPrice = item\.basePrice \+ priced\.reduce/);
  assert.match(catalog, /options: priced,/);
  const cart = src("../src/ordering/CartContext.tsx");
  assert.match(cart, /const priced = capLineOptions\(item, options\);/);
  assert.match(cart, /options: priced \};/);
  const modal = src("../src/ordering/ItemModal.tsx");
  assert.match(modal, /capToppingCharges\(chosen, \(o\) => o\.charge\)/);
  assert.match(modal, /capToppingCharges\(options, \(o\) => o\.placement != null\)/);
});

test("Brazil Ricotta, Corn and Hard Egg are off the menu, and stay off after a Clover re-pull", () => {
  const gen = src("../src/data/menuGenerated.ts");
  for (const t of ["Brazil Ricotta", "Corn", "Hard Egg"]) {
    assert.doesNotMatch(gen, new RegExp(`name: "${t}"`), `${t} is still in menuGenerated.ts`);
  }
  const builder = src("../scripts/build-menu.py");
  assert.match(builder, /EXCLUDED_TOPPINGS = \{"brazil ricotta", "corn", "hard egg"\}/);
  // The live snapshot copies options as of its last write; the page must take them from the build.
  const menu = src("../src/components/Menu.tsx");
  assert.match(menu, /setMenu\(withStaticOptions\(/);
});
