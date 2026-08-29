import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ORDER_LAST_HOUR, DELIVERY_LAST_HOUR } from "../src/lib/openStatus.ts";

/**
 * Online ordering closes at 11 PM every night (owner, 2026-08-27) even though the
 * counter runs to midnight Thu–Sun. These pin the two clocks apart: the ordering
 * gate must never outlive 11 PM, and the published counter hours must NOT be
 * quietly shortened to match it — the shop really is open late, and saying
 * otherwise costs walk-in business.
 */

test("online ordering stops at 11 PM, and delivery still stops before it", () => {
  assert.equal(ORDER_LAST_HOUR, 23);
  assert.ok(DELIVERY_LAST_HOUR < ORDER_LAST_HOUR, "delivery must close no later than ordering");
});

test("the ordering gate caps every day at ORDER_LAST_HOUR, counter hours included", () => {
  const src = readFileSync(new URL("../src/lib/openStatus.ts", import.meta.url), "utf8");
  // Both the in-day check and the past-midnight grace branch must go through the cap;
  // reading CLOSE_HOUR directly in either is how a midnight night leaks back in.
  const fn = src.slice(src.indexOf("export function isOrderingOpen"), src.indexOf("export const DELIVERY_LAST_HOUR"));
  assert.ok(!/CLOSE_HOUR\[/.test(fn), "isOrderingOpen must use orderingCloseHour(), never raw CLOSE_HOUR");
  assert.match(fn, /orderingCloseHour\(day\)/);
  assert.match(fn, /orderingCloseHour\(prevDay\)/);
  assert.match(src, /Math\.min\(CLOSE_HOUR\[day\] \?\? 23, ORDER_LAST_HOUR\)/);
});

test("counter hours stay as the owner confirmed them — ordering is capped, hours are not rewritten", () => {
  const hours = readFileSync(new URL("../src/data/hours.ts", import.meta.url), "utf8");
  // Thu–Sun still publish a midnight close. If someone "fixes" these to 11 PM the site
  // starts telling walk-ins the shop is shut while it is still serving.
  assert.match(hours, /const LATE = "10:00 AM – 12:00 AM"/);
  assert.equal((hours.match(/label: LATE/g) ?? []).length, 4, "Thu/Fri/Sat/Sun keep the late counter close");
  const status = readFileSync(new URL("../src/lib/openStatus.ts", import.meta.url), "utf8");
  const counter = status.slice(status.indexOf("const CLOSE_HOUR"), status.indexOf("export const ORDER_LAST_HOUR"));
  assert.match(counter, /\{ 0: 24, 1: 23, 2: 23, 3: 23, 4: 24, 5: 24, 6: 24 \}/);
});

test("the checkout UI gates on the ORDERING clock, never the counter clock", () => {
  const src = readFileSync(new URL("../src/ordering/Checkout.tsx", import.meta.url), "utf8");
  // storeClosed drives the closed banner AND the pay-disabled gate; if it reads
  // openStatus.open (the counter, to midnight Thu-Sun) a customer can build a cart and
  // enter a card at 11:30 PM only for the server to refuse the charge.
  assert.match(src, /const storeClosed = openStatus != null && !orderingOpen;/);
  assert.ok(!/const storeClosed = openStatus != null && !openStatus\.open/.test(src));
  // Both click-time rechecks use the same clock as the server — but asymmetrically, on
  // purpose: the MAIN button carves out a frozen attempt's replay (it re-sends the parked
  // key; the server answers read-only after close), while Apple Pay must NOT — an Apple Pay
  // tap mints a brand-new payment, which the closed gate exists to refuse.
  assert.equal((src.match(/if \(!isOrderingOpen\(\) && !attemptUncertain\)/g) ?? []).length, 1);
  assert.equal((src.match(/if \(!isOrderingOpen\(\)\)/g) ?? []).length, 1);
  assert.ok(!/if \(!getOpenStatus\(\)\.open\)/.test(src), "a click-time gate still reads the counter clock");
});

test("every closed-state message quotes the 11 PM ordering cutoff, not a counter time", () => {
  const checkout = readFileSync(new URL("../src/ordering/Checkout.tsx", import.meta.url), "utf8");
  const server = readFileSync(new URL("../api/order/create.ts", import.meta.url), "utf8");
  for (const [name, src] of [["checkout", checkout], ["server", server]] as const) {
    const msg = src.slice(Math.max(0, src.indexOf("Online ordering is closed right now") - 200), src.indexOf("Online ordering is closed right now") + 400);
    assert.ok(msg.includes("10 AM to 11 PM"), `${name} closed message must state the real ordering window`);
    assert.ok(!/midnight Thu/.test(msg), `${name} closed message still quotes the old midnight ordering window`);
  }
});
