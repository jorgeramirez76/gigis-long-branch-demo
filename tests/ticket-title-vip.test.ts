import assert from "node:assert/strict";
import { describe, it } from "node:test";
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.CLOVER_API_TOKEN ??= "test-only";
process.env.CLOVER_MERCHANT_ID ??= "test-merchant";
import { ticketTitle, WEBSITE_TITLE_RE } from "../api/lib/clover.ts";

// Owner, 2026-09-20: "There's nothing there to show the workers that this is a VIP." The title
// prints at the top of the chit in large bold type, so the VIP tag lives there.
describe("VIP tag in the ticket title", () => {
  it("names a VIP club member in the big title line", () => {
    assert.equal(ticketTitle("pickup", true, "member"), "WEBSITE ORDER • CUSTOMER PICKUP • PAID w/ CC • ** VIP CLUB MEMBER **");
  });
  it("tags an order that used a VIP promo code", () => {
    assert.equal(ticketTitle("pickup", true, "promo"), "WEBSITE ORDER • CUSTOMER PICKUP • PAID w/ CC • ** VIP PROMO **");
  });
  it("leaves an ordinary order's title unchanged", () => {
    assert.equal(ticketTitle("delivery", true), "WEBSITE ORDER • FOR DELIVERY • PAID w/ CC");
  });
  it("keeps VIP tickets findable by the open-ticket tools", () => {
    for (const vip of ["member", "promo", null] as const) assert.match(ticketTitle("pickup", true, vip), WEBSITE_TITLE_RE);
  });
});
