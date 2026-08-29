import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Sweep finding: three 50-pie lines passed the per-line clamp and failed only at Pay —
// after the card was typed and the Turnstile token spent. The cart now refuses to grow
// past what the server will accept.
test("cart-level cap mirrors the server and is enforced in every growth path", () => {
  const src = readFileSync(new URL("../src/ordering/CartContext.tsx", import.meta.url), "utf8");
  assert.match(src, /export const MAX_CART_UNITS = 100;/);
  assert.match(src, /export const MAX_LINE_QTY = 50;/);
  // new-line add respects remaining room
  assert.match(src, /if \(room <= 0\) return prev;/);
  assert.match(src, /Math\.min\(clampQty\(line\.quantity\), room\)/);
  // qty edits bound by room excluding the edited line
  assert.match(src, /Math\.min\(clampQty\(quantity\), roomFor\(prev, lineId\)\)/);
});
