import assert from "node:assert/strict";
import { describe, it } from "node:test";
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.CLOVER_API_TOKEN ??= "test-only";
process.env.CLOVER_MERCHANT_ID ??= "test-merchant";
import { buildOrderNote, type CartLineInput, type Totals } from "../api/lib/clover.ts";
import { applyFreePie } from "../api/lib/promo.ts";
import { applyBogoPizza } from "../api/lib/campaignPromo.ts";

/**
 * Kenny, 2026-09-20 (ported from Sea Bright 2026-09-21): the chit printed the whole
 * order TWICE — once in the order note at the top, once as line items below. The note
 * is now a HEADER ONLY, and what it must carry is: VIP, promo, name, phone, address.
 */

const LINES: CartLineInput[] = [
  { itemName: "Large Cheese Pizza", basePrice: 2200, quantity: 2, options: [{ group: "Prep", name: "Well Done" }], notes: "cut in squares" },
  { itemName: "Buffalo Wings", basePrice: 1400, quantity: 1, options: [{ group: "Wing Sauce", name: "Mild" }, { group: "Wing Sauce", name: "Sauce on Side" }] },
];
const TOTALS: Totals = { subtotal: 5800, cardPricing: 232, tax: 406, tip: 500, deliveryFee: 0, discount: 0, total: 6938 };

const base = {
  fulfillment: "pickup" as const,
  customer: { name: "Kenny Ramirez", phone: "(732) 555-0142", email: "k@example.com" },
  lines: LINES,
  totals: TOTALS,
  payment: "card" as const,
  chargeId: "YQ7K2M9X4ABCD",
};

describe("kitchen ticket header (order note)", () => {
  it("carries NO item names — the line items are the item detail", () => {
    const note = buildOrderNote({ ...base });
    for (const line of LINES) {
      assert.ok(!note.includes(line.itemName), `note must not repeat the item "${line.itemName}": ${note}`);
    }
    assert.ok(!note.includes("Well Done"), "note must not repeat option names");
    assert.ok(!note.includes("cut in squares"), "note must not repeat line notes");
    assert.ok(!/\d+x /.test(note), "note must not carry an item quantity list");
  });

  it("prints the header segments in the order the 490-char cap protects", () => {
    const note = buildOrderNote({
      ...base,
      orderNote: "PEANUT ALLERGY",
      vipMember: true,
      vipPromo: true,
      addressOnFile: { address: "55 Bradley Ave", apt: null, town: "Long Branch" },
    });
    const parts = note.split(" | ");
    assert.match(parts[0], /^WEBSITE ORDER · CUSTOMER PICKUP · \*\* PAID w\/ CC \$69\.38 \*\* \(Clover YQ7K2M9X4ABCD\)$/);
    assert.equal(parts[1], "★ VIP MEMBER ★");
    assert.equal(parts[2], "★ VIP PROMO ★");
    assert.equal(parts[3], "⚠ NOTE: PEANUT ALLERGY");
    assert.equal(parts[4], "Kenny Ramirez (732) 555-0142");
    assert.equal(parts[5], "Addr: 55 Bradley Ave, Long Branch");
    assert.match(parts[6], /^Sub \$58\.00 Tax \$4\.06 Tip \$5\.00 = \$69\.38$/);
    assert.equal(parts.length, 7);
  });

  it("marks a VIP member, and only when they are one", () => {
    assert.ok(buildOrderNote({ ...base, vipMember: true }).includes("★ VIP MEMBER ★"));
    assert.ok(!buildOrderNote({ ...base }).includes("★ VIP MEMBER ★"));
  });

  it("marks a VIP promo order, member marker first", () => {
    assert.ok(buildOrderNote({ ...base, vipPromo: true }).includes("★ VIP PROMO ★"));
    assert.ok(!buildOrderNote({ ...base }).includes("VIP PROMO"));
    const both = buildOrderNote({ ...base, vipMember: true, vipPromo: true });
    assert.ok(both.indexOf("★ VIP MEMBER ★") < both.indexOf("★ VIP PROMO ★"));
  });

  it("leaves the free-pie / BOGO marker on the LINE note, never in the header", () => {
    const pie = { itemName: "Plain Pie", categoryId: "pizza", basePrice: 1700, options: [], quantity: 1 };
    const freePie = applyFreePie([pie], "PIE-TEST01")!;
    assert.match(freePie.lines[0].notes ?? "", /FREE — VIP welcome pie PIE-TEST01/, "the line still says it");
    const pieNote = buildOrderNote({ ...base, lines: freePie.lines, payment: "free", vipPromo: true });
    assert.ok(!pieNote.includes("welcome pie"), `header must not repeat the line marker: ${pieNote}`);
    assert.ok(pieNote.includes("★ VIP PROMO ★"), "the header says a VIP promo was used instead");
    assert.match(pieNote, /FREE — VIP PROMO, NOTHING OWED/, "the $0.00 payment wording is unchanged");

    const bogo = applyBogoPizza([{ ...pie, quantity: 2 }], "GAMEDAY")!;
    const free = bogo.lines.find((l) => /^FREE — BOGO/.test(l.notes ?? ""));
    assert.ok(free, "BOGO still marks the free line");
    const bogoNote = buildOrderNote({ ...base, lines: bogo.lines, vipPromo: true });
    assert.ok(!bogoNote.includes("BOGO"), `header must not repeat the BOGO line marker: ${bogoNote}`);
    assert.ok(bogoNote.includes("★ VIP PROMO ★"));
  });

  it("prints the address on file on a PICKUP chit so staff stop writing it by hand", () => {
    const note = buildOrderNote({
      ...base,
      addressOnFile: { address: "55 Bradley Ave", apt: "Apt 2", town: "Long Branch" },
    });
    assert.ok(note.includes("Addr: 55 Bradley Ave, Apt 2, Long Branch"), note);
    // Nothing on file: no empty address segment.
    assert.ok(!buildOrderNote({ ...base }).includes("Addr:"));
    assert.ok(!buildOrderNote({ ...base, addressOnFile: { address: null, apt: null, town: null } }).includes("Addr:"));
  });

  it("keeps the delivery address + town, and ignores an address on file when delivering", () => {
    const note = buildOrderNote({
      ...base,
      fulfillment: "delivery",
      customer: { ...base.customer, address: "12 Ocean Ave", town: "Long Branch" },
      totals: { ...TOTALS, deliveryFee: 600, total: 7538 },
      addressOnFile: { address: "55 Bradley Ave", apt: null, town: "Oceanport" },
    });
    assert.ok(note.includes("Addr: 12 Ocean Ave, Long Branch"), note);
    assert.ok(!note.includes("Bradley"), "the delivery address is where the driver goes");
    assert.ok(note.includes("FOR DELIVERY (in-house driver)"));
    assert.ok(note.includes("Dlv $6.00"));
  });

  it("still shows the promo discount in the totals tail", () => {
    const note = buildOrderNote({ ...base, vipPromo: true, totals: { ...TOTALS, discount: 1700 } });
    assert.ok(note.includes("Promo -$17.00"), note);
  });

  it("stays inside Clover's 490-char note cap for a worst-case header", () => {
    const note = buildOrderNote({
      ...base,
      fulfillment: "delivery",
      customer: { name: "X".repeat(80), phone: "(732) 555-0142", address: "Y".repeat(120), town: "West Long Branch" },
      orderNote: "Z".repeat(130),
      vipMember: true,
      vipPromo: true,
      totals: { ...TOTALS, deliveryFee: 600, total: 7538 },
    });
    // The tail (totals) is all the cap may ever take; every safety field precedes it.
    const upToTotals = note.slice(0, note.lastIndexOf(" | Sub "));
    assert.ok(upToTotals.length < 490, `header must survive the cap, was ${upToTotals.length}`);
    assert.ok(note.slice(0, 490).includes("⚠ NOTE: ZZZ"));
    assert.ok(note.slice(0, 490).includes("★ VIP MEMBER ★"));
    assert.ok(note.slice(0, 490).includes("★ VIP PROMO ★"));
  });
});
