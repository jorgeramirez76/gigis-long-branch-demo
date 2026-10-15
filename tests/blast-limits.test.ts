/**
 * Email blasts send one at a time (~0.9 s each, to stay under Resend's rate limit), inside one
 * function run. At the old 300 s ceiling a list of roughly 300 email members would have been cut
 * off silently mid-send. These tests pin the larger ceiling, the dry-run estimate that warns before
 * a list outgrows one run, and the cron's rule against starting a second blast late in a run.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it, mock } from "node:test";
process.env.DATABASE_URL = "postgres://test:test@fake-neon.test/test";
process.env.CRON_SECRET = "cron-test-secret";
process.env.RESEND_API_KEY = "re_test";
process.env.EMAIL_FROM = "Gigi's <hello@gigislongbranch.com>";
process.env.UNSUB_SECRET = "unsub-test";
process.env.PUBLIC_BASE_URL = "https://gigislongbranch.com";
import { BLAST_RUN_LIMIT_SEC, blastDuration } from "../api/lib/broadcastRun.js";
import handler, { mayStartAnotherBlast } from "../api/cron/send-scheduled.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; mock.restoreAll(); mock.timers.reset(); });
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

describe("blast run ceiling", () => {
  it("vercel.json and both functions agree on the ceiling the estimate uses", () => {
    const vercel = JSON.parse(read("vercel.json")) as { functions: Record<string, { maxDuration: number }> };
    assert.equal(vercel.functions["api/admin/broadcast.ts"].maxDuration, BLAST_RUN_LIMIT_SEC);
    assert.equal(vercel.functions["api/cron/send-scheduled.ts"].maxDuration, BLAST_RUN_LIMIT_SEC);
    for (const file of ["api/admin/broadcast.ts", "api/cron/send-scheduled.ts"]) {
      assert.match(read(file), new RegExp(`export const config = \\{ maxDuration: ${BLAST_RUN_LIMIT_SEC} \\}`), file);
    }
    assert.ok(BLAST_RUN_LIMIT_SEC <= 800, "800 s is the Pro + Fluid compute maximum; more fails the deploy");
  });

  it("the dry-run estimate flags a list that would not finish in one run", () => {
    assert.deepEqual(blastDuration(40, 15), { estimatedSeconds: 16, fitsOneRun: true }, "today's lists take seconds");
    assert.equal(blastDuration(0, 600).fitsOneRun, true);
    assert.equal(blastDuration(0, 700).fitsOneRun, false, "700 emails is ~10.5 minutes, too close to the ceiling");
    assert.equal(blastDuration(2000, 0).fitsOneRun, true, "texts go out eight at a time");
  });

  it("the admin shows the warning before Send", () => {
    const admin = read("src/admin/AdminApp.tsx");
    assert.match(admin, /preview\.fitsOneRun === false/);
    assert.match(admin, /too big to send in one go/);
  });
});

describe("send-scheduled: a second blast only starts early in the run", () => {
  it("the rule", () => {
    assert.equal(mayStartAnotherBlast(0), true);
    assert.equal(mayStartAnotherBlast(BLAST_RUN_LIMIT_SEC * 250 - 1), true);
    assert.equal(mayStartAnotherBlast(BLAST_RUN_LIMIT_SEC * 250), false);
  });

  function cron(stepMs: number) {
    let now = Date.UTC(2026, 9, 14, 15, 0); // 11 AM EDT on a Wednesday: the shop is open, so the cron runs
    mock.timers.enable({ apis: ["Date"], now });
    mock.method(Date, "now", () => now);
    let claims = 0;
    const result = (data: Record<string, unknown>[] = []) => {
      const names = Object.keys(data[0] ?? {});
      return new Response(JSON.stringify({ command: "SELECT", rowCount: data.length, fields: names.map((name) => ({ name, dataTypeID: typeof data[0]?.[name] === "boolean" ? 16 : 25 })), rows: data.map((r) => names.map((n) => (typeof r[n] === "boolean" ? (r[n] ? "t" : "f") : r[n]))) }));
    };
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("api.resend.com")) return new Response(JSON.stringify({ id: "email" }));
      const { query: q } = JSON.parse(String(init?.body)) as { query: string };
      if (q.includes("UPDATE scheduled_broadcasts SET started_at")) {
        claims++;
        // Every claim finds a due email-only row (a fresh request id each time).
        return result([{ id: String(claims), business: "gigis_long_branch", subject: "Hi", message: `Blast ${claims}`, want_sms: false, want_email: true, send_at: "2026-10-14T14:00:00Z", request_id: `12345678-1234-4123-8123-12345678900${claims}` }]);
      }
      if (q.includes("UPDATE scheduled_broadcasts SET finished_at")) { now += stepMs; return result(); }
      if (q.includes("FROM vip_members")) return result([{ id: "1", name: "Fixture", phone: null, email: "vip@example.com" }]);
      if (q.includes("INSERT INTO broadcasts") || q.includes("SET delivery_started_at")) return result([{ id: "3" }]);
      return result();
    }) as typeof fetch;
    return () => claims;
  }
  const call = async () => {
    const res = { status() { return this; }, json() { return this; }, setHeader() { return this; } };
    await handler({ method: "GET", headers: { authorization: "Bearer cron-test-secret", "user-agent": "vercel-cron/1.0" }, query: {}, body: {} } as never, res as never);
  };

  it("quick blasts: up to three per tick, as before", async () => {
    const claims = cron(5_000);
    await call();
    assert.equal(claims(), 3);
  });

  it("a long first blast: the next due row waits for the next tick instead of starting late", async () => {
    const claims = cron(BLAST_RUN_LIMIT_SEC * 300);
    await call();
    assert.equal(claims(), 1);
  });
});
