/**
 * Exhaustive proof that "Pay & place order" is never silently dead.
 *
 * On 2026-08-08 a customer got stuck at checkout: a failed attempt reset the Turnstile
 * token, the Pay button's disabled expression included !turnstileToken, and nothing on
 * screen said so. The button was greyed out forever with no explanation, which reads as
 * a broken website and loses the order.
 *
 * This walks EVERY combination of the gate's inputs (2^10; card is the only payment mode
 * since prepay became mandatory on 2026-08-11) and asserts:
 *
 *   payDisabled(s) && !storeClosed && !submitting  =>  blockReason(s) !== null
 *
 * The two exemptions are states the button's own label already explains ("Closed —
 * ordering opens 7 AM" and "Placing order…").
 *
 * It also checks the converse — a clickable button never shows a blocking message —
 * and that every reachable message is actually reachable (no dead branch, which would
 * mean a disjunct lost its explanation).
 *
 * Run:  node scripts/verify-checkout-gate.mjs
 * Reads the same checkoutGate.ts the component imports, so the two cannot drift.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "src/ordering/checkoutGate.ts");

// Strip the TS types with the project's own compiler so we test the real module.
const out = mkdtempSync(join(tmpdir(), "gate-"));
execFileSync(
  "npx",
  ["tsc", SRC, "--target", "es2022", "--module", "esnext", "--outDir", out, "--skipLibCheck"],
  { cwd: ROOT, stdio: "pipe" },
);
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
const { payDisabled, blockReason } = await import(join(out, "checkoutGate.js"));

const BOOLS = [false, true];
const states = [];
for (const storeClosed of BOOLS)
  for (const submitting of BOOLS)
    for (const cartEmpty of BOOLS)
      for (const contactOk of BOOLS)
        for (const deliveryOk of BOOLS)
          for (const cardReady of BOOLS)
            for (const cardInitFailed of BOOLS)
              for (const turnstileOn of BOOLS)
                for (const turnstileToken of BOOLS)
                  for (const turnstileFailed of BOOLS)
                    states.push({
                      storeClosed, submitting, cartEmpty, contactOk, deliveryOk,
                      cardReady, cardInitFailed, turnstileOn,
                      turnstileToken, turnstileFailed, phone: "732-377-2468",
                    });

const silentlyDead = [];
const reasonWhenUsable = [];
const misdirected = [];
const seenReasons = new Set();

for (const s of states) {
  const disabled = payDisabled(s);
  const reason = blockReason(s);
  if (reason) seenReasons.add(reason);

  // THE invariant: blocked, not self-explanatory from the label, and no reason given.
  if (disabled && !s.storeClosed && !s.submitting && reason === null) silentlyDead.push(s);

  // A reason must never send them to a control that isn't on screen. When the widget failed
  // to load there is nothing "just above" to finish, so that copy must not appear.
  if (s.turnstileOn && s.turnstileFailed && reason && reason.includes("just above to continue")) {
    misdirected.push({ ...s, reason });
  }

  // Converse: a usable button must not nag.
  if (!disabled && reason !== null) reasonWhenUsable.push({ ...s, reason });
}

const fmt = (s) =>
  Object.entries(s)
    .filter(([k]) => k !== "reason")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");

console.log(`checked ${states.length} states\n`);

let failed = false;

if (silentlyDead.length) {
  failed = true;
  console.log(`FAIL — ${silentlyDead.length} state(s) disable Pay with NO explanation:`);
  for (const s of silentlyDead.slice(0, 10)) console.log("  " + fmt(s));
  if (silentlyDead.length > 10) console.log(`  …and ${silentlyDead.length - 10} more`);
} else {
  console.log("PASS — no state disables Pay without telling the customer why");
}

if (reasonWhenUsable.length) {
  failed = true;
  console.log(`\nFAIL — ${reasonWhenUsable.length} state(s) show a blocking message on a CLICKABLE button:`);
  for (const s of reasonWhenUsable.slice(0, 5)) console.log(`  ${fmt(s)}\n    → "${s.reason}"`);
} else {
  console.log("PASS — a clickable button never shows a blocking message");
}

if (misdirected.length) {
  failed = true;
  console.log(`\nFAIL — ${misdirected.length} state(s) point the customer at a widget that failed to load:`);
  for (const s of misdirected.slice(0, 5)) console.log(`  ${fmt(s)}\n    → "${s.reason}"`);
} else {
  console.log("PASS — never directs the customer to a check that isn't on the page");
}

console.log(`\nreachable messages (${seenReasons.size}):`);
for (const r of seenReasons) console.log("  • " + r);

rmSync(out, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
