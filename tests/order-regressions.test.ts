import assert from "node:assert/strict";
import test from "node:test";
import { classifyCharge } from "../api/lib/chargeOutcome.ts";
import { replayOrder } from "../api/lib/orderReplay.ts";
import { isDefinitelyDeclined } from "../api/lib/paymentRetry.ts";

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
});

test("only an explicitly marked payment decline may release an order for retry", () => {
  assert.equal(isDefinitelyDeclined(Object.assign(new Error("declined"), { retrySafe: true })), true);
  assert.equal(isDefinitelyDeclined(Object.assign(new Error("tender lookup 404"), { status: 404 })), false);
  assert.equal(isDefinitelyDeclined(Object.assign(new Error("capture uncertain"), { status: 502 })), false);
});
