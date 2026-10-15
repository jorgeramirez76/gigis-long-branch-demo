import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The two frequent crons (sweep-prints, send-scheduled) run every 20 minutes and only while the
 * shop is open (api/lib/cronHours.ts, decided 2026-10-15). Outside the counter hours a tick must
 * answer 200 without a single database call, so a closed-hours tick never wakes Neon; inside
 * them it must still do its work. The vercel.json schedule is UTC, so the last test walks every
 * 20-minute tick of a summer week and a winter week and checks that each open-hours tick falls in
 * an hour the schedule fires on.
 *
 * The clock is pinned with mock.timers (Date only). Plain `=` on env vars, never `??=`.
 */

process.env.DATABASE_URL = "postgres://test:test@fake-neon.test/test";
process.env.CRON_SECRET = "cron-test-secret";
process.env.RESEND_API_KEY = "re_test";
process.env.EMAIL_FROM = "Gigi's <hello@gigislongbranch.com>";
process.env.UNSUB_SECRET = "unsub-test";
process.env.PUBLIC_BASE_URL = "https://gigislongbranch.com";
process.env.STAFF_ALERT_PHONE = "+15555550123";
delete process.env.TWILIO_ACCOUNT_SID;

const sweep = (await import("../api/cron/sweep-prints.js")).default;
const sendScheduled = (await import("../api/cron/send-scheduled.js")).default;
const { shopOpenForCron } = await import("../api/lib/cronHours.js");
const { CLOSED_DATES, getOpenStatus } = await import("../src/lib/openStatus.js");

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.timers.reset();
  for (const k of Object.keys(CLOSED_DATES)) delete CLOSED_DATES[k];
});

/** Counts every Neon-over-HTTP call and answers each with an empty result. */
function neonCounter() {
  const calls: string[] = [];
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    const { query } = JSON.parse(String(init?.body ?? "{}"));
    calls.push(String(query).replace(/\s+/g, " ").slice(0, 50));
    return new Response(JSON.stringify({ command: "SELECT", rowCount: 0, fields: [], rows: [] }));
  }) as typeof globalThis.fetch;
  return calls;
}
function at(iso: string) {
  mock.timers.enable({ apis: ["Date"], now: new Date(iso).getTime() });
}
function run(handler: (req: never, res: never) => Promise<void>) {
  const state: { status: number; body: Record<string, unknown> } = { status: 0, body: {} };
  const res = { status(n: number) { state.status = n; return this; }, json(v: Record<string, unknown>) { state.body = v; return this; }, setHeader() { return this; } };
  const req = { method: "GET", headers: { authorization: "Bearer cron-test-secret", "user-agent": "vercel-cron/1.0" }, query: {}, body: {} };
  return handler(req as never, res as never).then(() => state);
}

describe("the frequent crons only work while the shop is open", () => {
  it("a closed-hours tick answers 200 and never touches the database", async () => {
    at("2026-10-14T07:30:00Z"); // 3:30 AM EDT, Wednesday
    assert.equal(shopOpenForCron(), false);
    const calls = neonCounter();
    const s1 = await run(sweep);
    assert.equal(s1.status, 200);
    assert.equal(s1.body.skipped, "shop_closed");
    const s2 = await run(sendScheduled);
    assert.equal(s2.status, 200);
    assert.equal(s2.body.skipped, "shop_closed");
    assert.deepEqual(s2.body.sent, []);
    assert.deepEqual(calls, [], "no Neon query on a closed-hours tick");
  });

  it("the minutes just after close are closed too, even though the schedule still fires", async () => {
    at("2026-10-15T03:20:00Z"); // 11:20 PM EDT on Wednesday: counter closed at 11 PM
    const calls = neonCounter();
    const s = await run(sweep);
    assert.equal(s.body.skipped, "shop_closed");
    assert.deepEqual(calls, []);
  });

  it("an open-hours tick does the work", async () => {
    at("2026-10-14T16:00:00Z"); // noon EDT, Wednesday
    assert.equal(shopOpenForCron(), true);
    const calls = neonCounter();
    const s1 = await run(sweep);
    assert.equal(s1.status, 200);
    assert.equal(s1.body.skipped, undefined);
    const s2 = await run(sendScheduled);
    assert.equal(s2.status, 200);
    assert.equal(s2.body.skipped, undefined);
    assert.ok(calls.length > 0, "the sweep and the blast queue were read");
    assert.ok(calls.some((q) => q.includes("UPDATE scheduled_broadcasts SET started_at")), "the blast claim ran");
  });

  it("a late Saturday tick is open: the counter runs to midnight Thu-Sun", async () => {
    at("2026-10-18T03:40:00Z"); // 11:40 PM EDT, Saturday
    assert.equal(shopOpenForCron(), true);
  });

  it("a CLOSED_DATES day is closed all day", async () => {
    CLOSED_DATES["2026-10-14"] = "test holiday";
    at("2026-10-14T16:00:00Z"); // noon EDT on the closed day
    assert.equal(shopOpenForCron(), false);
    const calls = neonCounter();
    const s = await run(sendScheduled);
    assert.equal(s.body.skipped, "shop_closed");
    assert.deepEqual(calls, []);
  });

  it("the vercel.json schedule fires on every open-hours tick, summer and winter", () => {
    const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as { crons: { path: string; schedule: string }[] };
    for (const path of ["/api/cron/sweep-prints", "/api/cron/send-scheduled"]) {
      const cron = vercel.crons.find((c) => c.path === path);
      assert.ok(cron, `${path} is scheduled`);
      const [minutes, hours] = cron.schedule.split(" ");
      assert.equal(minutes, "*/20", `${path} runs every 20 minutes`);
      const hourSet = new Set<number>();
      for (const part of hours.split(",")) {
        const [a, b] = part.split("-").map(Number);
        for (let h = a; h <= (b ?? a); h++) hourSet.add(h);
      }
      let openTicks = 0;
      for (const week of ["2026-07-13", "2026-12-07"]) { // a Monday in summer and in winter
        for (let day = 0; day < 7; day++) {
          for (let h = 0; h < 24; h++) {
            for (const m of [0, 20, 40]) {
              const t = new Date(`${week}T00:00:00Z`);
              t.setUTCDate(t.getUTCDate() + day);
              t.setUTCHours(h, m, 0, 0);
              mock.timers.enable({ apis: ["Date"], now: t.getTime() });
              const open = getOpenStatus().open;
              mock.timers.reset();
              if (!open) continue;
              openTicks++;
              assert.ok(hourSet.has(h), `${path}: the shop is open at ${t.toISOString()} but the schedule skips UTC hour ${h}`);
            }
          }
        }
      }
      assert.ok(openTicks > 2 * 7 * 30, "the walk found the open-hours ticks");
    }
  });
});
