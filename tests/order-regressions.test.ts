import assert from "node:assert/strict";
import test from "node:test";
import { classifyCharge } from "../api/lib/chargeOutcome.ts";
import { replayOrder } from "../api/lib/orderReplay.ts";
import { availabilityKey, QUALIFIED_MARKER } from "../api/lib/menuAvailability.ts";
import { isDefinitelyDeclined } from "../api/lib/paymentRetry.ts";
import { classifyPrintPoll } from "../api/lib/printOutcome.ts";

test("unknown or contradictory Clover responses are never treated as safe declines", () => {
  assert.equal(classifyCharge({ status: "complete", paid: false }), "uncertain");
  assert.equal(classifyCharge({ status: "paid", captured: false }), "uncertain");
  assert.equal(classifyCharge({ status: "declined", paid: true }), "uncertain");
  assert.equal(classifyCharge({ status: "declined", paid: false }), "failed");
  assert.equal(classifyCharge({ status: "paid", paid: true }), "captured");
});

test("an unfinished draft is not replayed as a completed order", () => {
  assert.deepEqual(
    replayOrder({ id: 1, status: "pending", chargeId: null, cloverOrderId: "draft-1", ageSec: 4 }),
    { kind: "uncertain", paid: false },
  );
});

test("capture uncertainty stays distinct from a confirmed paid routing failure", () => {
  assert.deepEqual(
    replayOrder({ id: 1, status: "capture_uncertain", chargeId: null, cloverOrderId: "draft-1", ageSec: 4 }),
    { kind: "uncertain", paid: false },
  );
  assert.deepEqual(
    replayOrder({ id: 1, status: "paid_unrouted", chargeId: "pay-1", cloverOrderId: "order-1", ageSec: 4 }),
    { kind: "routing_issue", paid: true },
  );
  assert.deepEqual(
    replayOrder({ id: 1, status: "paid_print_failed", chargeId: "pay-1", cloverOrderId: "order-1", ageSec: 4 }),
    { kind: "routing_issue", paid: true },
  );
});

test("only an explicitly marked payment decline may release an order for retry", () => {
  assert.equal(isDefinitelyDeclined(Object.assign(new Error("declined"), { retrySafe: true })), true);
  assert.equal(isDefinitelyDeclined(Object.assign(new Error("tender lookup 404"), { status: 404 })), false);
  assert.equal(isDefinitelyDeclined(Object.assign(new Error("capture uncertain"), { status: 502 })), false);
});

test("a queued Clover print event is not mistaken for a completed kitchen ticket", () => {
  assert.equal(classifyPrintPoll("CREATED"), "pending");
  assert.equal(classifyPrintPoll("PRINTING"), "pending");
  assert.equal(classifyPrintPoll("FAILED"), "failed");
  // Clover discards successful print events; its documented 404 is the completion signal.
  assert.equal(classifyPrintPoll(undefined, 404), "printed");
  // ...but this merchant's API actually answers a consumed event with 400 "The print event is
  // missing". Reading only 404 made every printed ticket look unconfirmed (2026-08-16 false alarm).
  assert.equal(classifyPrintPoll(undefined, 400, '{"message":"The print event is missing"}'), "printed");
  // A 400 for any other reason is still not proof of paper.
  assert.equal(classifyPrintPoll(undefined, 400, '{"message":"Bad request"}'), "pending");
  assert.equal(classifyPrintPoll(undefined, 400), "pending");
});

test("a paid order whose ticket is still queued replays as the placed order, not a warning", () => {
  // The customer paid and the order is in the POS; only the paper is still on its way. A retry of
  // the same key must show them the order they already placed.
  assert.deepEqual(
    replayOrder({ id: 1, status: "paid_print_queued", chargeId: "pay-1", cloverOrderId: "order-1", ageSec: 4 }),
    { kind: "completed", paid: true },
  );
  // A cash/pickup order that was placed but never charged still replays as unpaid.
  assert.deepEqual(
    replayOrder({ id: 1, status: "placed", chargeId: null, cloverOrderId: "order-1", ageSec: 4 }),
    { kind: "completed", paid: false },
  );
});

test("availability keys separate same-named items in different menu sections", () => {
  // Shrimp Oreganata is a $27.04 seafood dinner AND a $67.60 catering tray. Pulling one off
  // Clover must not leave the other one's name vouching for it.
  const live = new Set([availabilityKey("seafood", "Shrimp Oreganata"), "Shrimp Oreganata", QUALIFIED_MARKER]);
  assert.equal(live.has(availabilityKey("seafood", "Shrimp Oreganata")), true);
  assert.equal(live.has(availabilityKey("catering", "Shrimp Oreganata")), false);
});
