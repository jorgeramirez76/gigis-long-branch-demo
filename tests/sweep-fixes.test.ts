import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("ledger errors throw instead of reading as 'no charge — owed money'", () => {
  const store = read("../api/lib/orderStore.ts");
  assert.match(store, /getCaptureByCloverId failed", cloverOrderId, e\);\s*throw e;/);
  const wl = read("../api/admin/open-tickets.ts");
  assert.match(wl, /!o\.chargeId && !o\.ledgerUnknown/);
  assert.match(wl, /LEDGER UNREACHABLE/);
});

test("the worklist checks ledger candidates individually, beyond the scan window", () => {
  const wl = read("../api/admin/open-tickets.ts");
  assert.match(wl, /listWorklistCandidates\(\)/);
  assert.match(wl, /getOrderSummary\(c\.cloverOrderId\)/);
});

test("a short ecomm read retries and consults REST instead of aborting the sale", () => {
  const clover = read("../api/lib/clover.ts");
  assert.match(clover, /if \(expected === undefined \|\| amount >= expected\) return amount;/);
  assert.match(clover, /typeof d\?\.total === "number" \? d\.total === expected : null/);
  const create = read("../api/order/create.ts");
  assert.match(create, /getEcommOrderAmount\(draftId, orderAmount\)/);
});

test("a frozen customer's replay is answered even after the 11 PM close", () => {
  const create = read("../api/order/create.ts");
  assert.match(create, /!isOrderingOpen\(5\) && !closedReplayAnswers/);
  // "retry" means place a NEW order — that must never slip past the closed gate.
  assert.match(create, /replayOrder\(closedReplay\)\.kind !== "retry"/);
});
