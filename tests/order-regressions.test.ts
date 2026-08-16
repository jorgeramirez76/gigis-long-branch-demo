import assert from "node:assert/strict";
import test from "node:test";
import { classifyCharge } from "../api/lib/chargeOutcome.ts";
import { replayOrder } from "../api/lib/orderReplay.ts";
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
