/**
 * Anonymous and public traffic must not wake Neon for nothing (b8bcc15 lets the database sleep
 * between cron ticks). Three leaks are closed here: signed-in-only account actions called with no
 * session cookie, a 10-minute CDN lifetime on /api/menu, and rate_counters rows nobody pruned.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { ACCOUNT_ORIGIN } from "../api/lib/session.js";
import { accountHandler } from "../api/lib/accountHandler.js";
import { menuCdnMaxAgeSec, MENU_REFRESH_UTC_HOURS } from "../api/menu.js";
import { pruneRateCounters } from "../api/lib/rateLimit.js";

process.env.DATABASE_URL = "postgres://test:test@fake-neon.test/test";
process.env.ACCOUNTS_ENABLED = "true";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

/** Records every Neon query; answers each with an empty result. */
function neon() {
  const queries: { query: string; params: unknown[] }[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const { query, params } = JSON.parse(String(init?.body)) as { query: string; params: unknown[] };
    queries.push({ query, params });
    return new Response(JSON.stringify({ command: "SELECT", rowCount: 0, fields: [], rows: [] }));
  }) as typeof fetch;
  return queries;
}

async function call(action: string, cookie?: string) {
  const get = ["me", "orders"].includes(action);
  const state = { status: 0, body: {} as Record<string, unknown> };
  const res = { status(n: number) { state.status = n; return this; }, json(v: Record<string, unknown>) { state.body = v; return this; }, setHeader() { return this; } };
  await accountHandler(action)({
    method: get ? "GET" : "POST",
    headers: { origin: ACCOUNT_ORIGIN, "content-type": "application/json", "x-real-ip": "203.0.113.9", ...(cookie ? { cookie } : {}) },
    query: {}, body: {},
  } as never, res as never);
  return state;
}

describe("signed-in account actions without a session cookie", () => {
  for (const action of ["me", "orders", "reorder", "upsell", "upsell-add", "consent", "delete"]) {
    it(`${action}: 401 without a single database query`, async () => {
      const queries = neon();
      const r = await call(action);
      assert.equal(r.status, 401);
      assert.equal(r.body.error, "sign_in_required");
      assert.equal(queries.length, 0, `${action} reached Neon: ${queries.map((q) => q.query.slice(0, 40)).join(" | ")}`);
    });
  }

  it("a request that carries a session cookie is still rate-limited and looked up", async () => {
    const queries = neon();
    const r = await call("upsell", "__Host-gigis_session=" + "C".repeat(43));
    assert.equal(r.status, 401, "an unknown session is still refused");
    assert.ok(queries.some((q) => q.query.includes("rate_counters")), "the rate limit still runs");
    assert.ok(queries.some((q) => q.query.includes("FROM account_sessions")), "the session is still checked");
  });

  it("public actions are unaffected (they never needed a cookie)", async () => {
    const queries = neon();
    const r = await call("login");
    assert.notEqual(r.body.error, "sign_in_required");
    assert.ok(queries.length > 0, "login still reaches its rate limit");
  });
});

describe("/api/menu CDN lifetime", () => {
  const at = (iso: string) => menuCdnMaxAgeSec(new Date(iso));

  it("lasts until shortly after the next refresh-menu run", () => {
    assert.equal(at("2026-10-14T07:00:00Z"), 70 * 60, "before the 08:00 UTC run: until 08:10");
    assert.equal(at("2026-10-14T08:05:00Z"), 5 * 60);
    assert.equal(at("2026-10-14T08:30:00Z"), 40 * 60, "between the two runs: until 09:10");
    assert.equal(at("2026-10-14T09:30:00Z"), 40 * 60, "safety expiry at 10:10");
    assert.equal(at("2026-10-14T10:30:00Z"), 40 * 60, "and at 11:10");
    assert.equal(at("2026-10-14T12:00:00Z"), (20 * 60 + 10) * 60, "after both: until 08:10 tomorrow");
    assert.equal(at("2026-10-14T23:59:00Z"), (8 * 60 + 11) * 60);
  });

  it("in winter a late 4 AM run (09:00 UTC) is picked up within the hour, not the next day", () => {
    // EST from Nov 1: 4 AM Eastern is 09:00 UTC, the later of the two runs.
    assert.equal(at("2026-12-01T09:05:00Z"), 5 * 60, "a punctual run is read at 09:10");
    for (const late of ["09:10", "09:40", "10:15", "10:55"]) {
      const s = at(`2026-12-01T${late}:00Z`);
      assert.ok(s <= 60 * 60, `cached at ${late} UTC (a run that landed late) expires within the hour: ${s}s`);
    }
  });

  it("never drops below a minute or exceeds a day", () => {
    assert.equal(at("2026-10-14T08:09:59.500Z"), 60);
    for (let h = 0; h < 24; h++) {
      const s = at(`2026-11-02T${String(h).padStart(2, "0")}:17:00Z`);
      assert.ok(s >= 60 && s <= 86_400, `hour ${h}: ${s}`);
    }
  });

  it("matches the refresh-menu cron schedule", () => {
    const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as { crons: { path: string; schedule: string }[] };
    const cron = vercel.crons.find((c) => c.path === "/api/cron/refresh-menu");
    assert.equal(cron?.schedule, `0 ${MENU_REFRESH_UTC_HOURS.join(",")} * * *`, "change MENU_REFRESH_UTC_HOURS with the cron");
  });
});

describe("rate_counters cleanup", () => {
  it("deletes only windows older than 26 hours", async () => {
    const queries = neon();
    const now = Date.UTC(2026, 9, 14, 11, 5);
    await pruneRateCounters(now);
    const del = queries.find((q) => q.query.startsWith("DELETE FROM rate_counters"));
    assert.ok(del, "a DELETE ran");
    assert.equal(Number(del.params[0]), Math.floor(now / 1000) - 26 * 3600);
  });

  it("runs once a day from the digest cron", () => {
    const digest = readFileSync(new URL("../api/cron/daily-digest.ts", import.meta.url), "utf8");
    assert.match(digest, /await pruneRateCounters\(\)\.catch\(/);
  });
});
