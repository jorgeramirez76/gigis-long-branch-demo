import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * Source pins for the "lost your code?" recovery. The endpoint is I/O all the way
 * down, so what a unit test can hold in place are its safety properties: the code
 * only ever travels BY EMAIL, every on-screen outcome is uniform, and the abuse
 * gates run before the work.
 */
describe("VIP code recovery safety pins", () => {
  const src = readFileSync(new URL("../api/vip-code-recovery.ts", import.meta.url), "utf8");
  const clubSrc = readFileSync(new URL("../src/components/VipClub.tsx", import.meta.url), "utf8");

  it("no HTTP response ever carries a code", () => {
    // Every res.*.json(...) body in the file, checked for a code field.
    for (const body of src.match(/\.json\(\{[^)]*\)/gs) ?? []) {
      assert.ok(!/\bcode\b\s*:/.test(body), `response body leaks a code field: ${body.slice(0, 80)}`);
    }
  });

  it("every success outcome returns the one uniform message", () => {
    // Exactly one 200 exit, and it uses the shared constant — a second, branch-specific
    // 200 is how membership probing sneaks back in.
    const oks = src.match(/status\(200\)\.json/g) ?? [];
    assert.equal(oks.length, 1, "expected exactly one 200 exit");
    assert.match(src, /status\(200\)\.json\(\{ ok: true, message: UNIFORM_MESSAGE \}\)/);
  });

  it("bot check and rate limits run before any lookup or send", () => {
    // Call sites, not the import lines at the top of the file.
    const turnstile = src.indexOf("await verifyTurnstile");
    const limits = src.indexOf("await rateLimitAll");
    const firstQuery = src.indexOf("SELECT c.code"); // the first DB read in the handler
    const firstSend = Math.min(
      ...["await emailCode(", "await emailNoActiveCode("].map((n) => src.indexOf(n)).filter((i) => i > 0),
    );
    assert.ok(turnstile > 0 && limits > 0 && firstQuery > 0 && firstSend > 0);
    assert.ok(turnstile < limits, "turnstile before rate limits");
    assert.ok(limits < firstQuery, "rate limits before the member lookup");
    assert.ok(limits < firstSend, "rate limits before any email");
  });

  it("per-email send caps exist and are tight", () => {
    assert.match(src, /recover:email:\$\{normalizedEmail\}:h`, max: 2, windowSec: 3600/);
    assert.match(src, /recover:email:\$\{normalizedEmail\}:d`, max: 4, windowSec: 86400/);
  });

  it("member lookup is case-insensitive — hand-imported mixed-case emails must match", () => {
    assert.match(src, /LOWER\(email\) = \$\{normalizedEmail\}/);
  });

  it("a redeemed code can never become a second pie", () => {
    // Exactly ONE mint call site in the whole endpoint, and it sits between the
    // atomic claim and the uniform response — bounded slices, not lazy spans.
    const mints = src.match(/issueWelcomePie\(/g) ?? [];
    assert.equal(mints.length, 1, "expected exactly one mint call site");
    const claimIdx = src.indexOf("claimWindow(`recover-mint:");
    const recheckIdx = src.indexOf("SELECT 1 FROM vip_promo_codes");
    const mintIdx = src.indexOf("issueWelcomePie(");
    assert.ok(claimIdx > 0 && recheckIdx > claimIdx && mintIdx > recheckIdx,
      "mint must run only after the atomic claim AND the under-claim re-check");
    // The claim is handed back in a finally — a failed mint must not wedge the member.
    const mintRegion = src.slice(claimIdx, src.indexOf("} else if (member)"));
    assert.match(mintRegion, /finally \{\s*await releaseWindow/);
    // The redeemed path emails the no-active-code notice, never a promo block.
    const redeemed = src.slice(src.indexOf("} else if (row) {"), src.indexOf("} else {"));
    assert.ok(redeemed.includes("emailNoActiveCode"), "redeemed branch must send the notice");
    assert.ok(!redeemed.includes("emailCode("), "redeemed branch sends a code");
  });

  it("code lookup aggregates across case-variant member rows — never keyed to one arbitrary row", () => {
    // One inbox can own a mixed-case imported row AND a lowercase web row; the code
    // search must JOIN on LOWER(email), not pick a member id first.
    const lookup = src.slice(src.indexOf("SELECT c.code"), src.indexOf("const row"));
    assert.match(lookup, /JOIN vip_members m ON/);
    assert.match(lookup, /LOWER\(m\.email\) = \$\{normalizedEmail\}/);
    // And the redeemed check must therefore see a sibling row's pie: unredeemed-first ordering.
    // "live" = unredeemed AND unexpired — an expired code must never be emailed as active.
    assert.match(lookup, /c\.expires_at IS NULL OR c\.expires_at > now\(\)/);
    assert.match(lookup, /ORDER BY live DESC/);
  });

  it("minting is reserved for web-flow members — imports never get a pie they weren't owed", () => {
    assert.match(src, /const WEB_SOURCES = \["website", "checkout", "receipt", "menu-qr", "winback"\]/);
    assert.match(src, /WEB_SOURCES\.includes\(member\.source \?\? ""\)/);
  });

  it("the recovery block lives OUTSIDE the join form — Enter can never fire the join submit", () => {
    const formClose = clubSrc.indexOf("</form>");
    const recoveryBlock = clubSrc.indexOf("Self-serve code recovery");
    assert.ok(formClose > 0 && recoveryBlock > formClose,
      "recovery UI must render after the join form closes");
  });

  it("recoverCode is re-entrancy guarded — Enter cannot double-submit", () => {
    const start = clubSrc.indexOf("async function recoverCode");
    const fn = clubSrc.slice(start, clubSrc.indexOf("/api/vip-code-recovery", start));
    assert.match(fn, /if \(recoverStatus === "submitting"\) return;/);
  });

  it("the club UI never renders a recovered code — email-only by construction", () => {
    const block = clubSrc.slice(clubSrc.indexOf("async function recoverCode"), clubSrc.indexOf('if (status === "verify")'));
    assert.ok(block.length > 100);
    assert.ok(!/data\.code/.test(block), "recovery handler reads a code off the response");
    assert.match(clubSrc, /never shown on this page/);
  });
});
