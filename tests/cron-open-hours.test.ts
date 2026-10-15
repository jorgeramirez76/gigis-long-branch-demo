import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The two frequent crons (sweep-prints, send-scheduled) run every 20 minutes and only while the
 * shop is open (api/lib/cronHours.ts, decided 2026-10-15). The sweep follows online ordering
 * (10 AM-11 PM) plus a 45-minute tail so the night's last tickets are still checked; the blast
 * cron follows the counter's weekday hours and ignores CLOSED_DATES. Outside its window a
 * scheduled tick must answer 200 without a single database call, so it never wakes Neon; inside
 * it must still do its work; and a hand-run hit with the secret is never gated. The vercel.json
 * schedule is UTC, so the last test walks every 20-minute tick of four weeks (mid-summer,
 * mid-winter and the two daylight-saving switches) and checks that each open tick falls in an hour
 * the schedule fires on, with the exact expected number of open ticks per week.
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
const { SWEEP_TAIL_MINUTES, blastWindowOpen, sweepWindowOpen } = await import("../api/lib/cronHours.js");
const { CLOSED_DATES } = await import("../src/lib/openStatus.js");

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.timers.reset();
  process.env.CRON_SECRET = "cron-test-secret";
  for (const k of Object.keys(CLOSED_DATES)) delete CLOSED_DATES[k];
});

/** Counts every Neon-over-HTTP call and answers each with an empty result. */
function neonCounter() {
  const calls: string[] = [];
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    const { query } = JSON.parse(String(init?.body ?? "{}"));
    calls.push(String(query).replace(/\s+/g, " ").slice(0, 300));
    return new Response(JSON.stringify({ command: "SELECT", rowCount: 0, fields: [], rows: [] }));
  }) as typeof globalThis.fetch;
  return calls;
}
function at(iso: string) {
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: new Date(iso).getTime() });
}
const CRON_UA = "vercel-cron/1.0";
function run(handler: (req: never, res: never) => Promise<void>, { auth = "Bearer cron-test-secret", ua = CRON_UA } = {}) {
  const state: { status: number; body: Record<string, unknown> } = { status: 0, body: {} };
  const res = { status(n: number) { state.status = n; return this; }, json(v: Record<string, unknown>) { state.body = v; return this; }, setHeader() { return this; } };
  const req = { method: "GET", headers: { authorization: auth, "user-agent": ua }, query: {}, body: {} };
  return handler(req as never, res as never).then(() => state);
}
const sweepQueried = (calls: string[]) => calls.some((q) => q.includes("FROM web_orders"));
const blastClaimed = (calls: string[]) => calls.some((q) => q.includes("UPDATE scheduled_broadcasts SET started_at"));

describe("the frequent crons only work while the shop is open", () => {
  it("a closed-hours tick answers 200 and never touches the database", async () => {
    at("2026-10-14T07:30:00Z"); // 3:30 AM EDT, Wednesday
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

  it("an open-hours tick does the work for both crons", async () => {
    at("2026-10-14T16:00:00Z"); // noon EDT, Wednesday
    const calls = neonCounter();
    const s1 = await run(sweep);
    assert.equal(s1.status, 200);
    assert.equal(s1.body.skipped, undefined);
    assert.ok(sweepQueried(calls), "the sweep read the orders table");
    const before = calls.length;
    const s2 = await run(sendScheduled);
    assert.equal(s2.status, 200);
    assert.equal(s2.body.skipped, undefined);
    assert.ok(blastClaimed(calls.slice(before)), "the blast claim ran");
  });

  it("after the 11 PM close the sweep keeps running for its tail, the blast cron does not", async () => {
    at("2026-10-15T03:20:00Z"); // 11:20 PM EDT, Wednesday: ordering closed at 11, counter too
    let calls = neonCounter();
    assert.equal((await run(sweep)).body.skipped, undefined, "the sweep still checks the night's last tickets");
    assert.ok(sweepQueried(calls));
    calls = neonCounter();
    assert.equal((await run(sendScheduled)).body.skipped, "shop_closed", "no blast after the counter closes");
    assert.deepEqual(calls, []);
    at("2026-10-15T04:00:00Z"); // midnight: past the tail
    calls = neonCounter();
    assert.equal((await run(sweep)).body.skipped, "shop_closed");
    assert.deepEqual(calls, []);
  });

  it("a blast queued overnight goes out at the 10 AM tick", async () => {
    at("2026-10-15T07:30:00Z"); // 3:30 AM
    let calls = neonCounter();
    await run(sendScheduled);
    assert.ok(!blastClaimed(calls), "nothing claimed while closed");
    at("2026-10-15T14:00:00Z"); // 10:00 AM EDT, the first tick of the day
    calls = neonCounter();
    const s = await run(sendScheduled);
    assert.equal(s.body.skipped, undefined);
    assert.ok(blastClaimed(calls), "the queue is drained at the 10 AM tick");
  });

  it("a CLOSED_DATES day: no sweep (no orders can exist), but a 'closed today' blast still goes out", async () => {
    CLOSED_DATES["2026-10-14"] = "test holiday";
    at("2026-10-14T16:00:00Z"); // noon on the closed day
    let calls = neonCounter();
    assert.equal((await run(sweep)).body.skipped, "shop_closed");
    assert.deepEqual(calls, []);
    calls = neonCounter();
    assert.equal((await run(sendScheduled)).body.skipped, undefined);
    assert.ok(blastClaimed(calls), "the holiday notice is sent on the holiday");
  });

  it("a hand-run hit with the secret is never gated", async () => {
    at("2026-10-14T07:30:00Z"); // 3:30 AM
    const calls = neonCounter();
    const s1 = await run(sweep, { ua: "curl/8.7.1" });
    assert.equal(s1.status, 200);
    assert.equal(s1.body.skipped, undefined);
    assert.ok(sweepQueried(calls));
    const s2 = await run(sendScheduled, { ua: "Mozilla/5.0" });
    assert.equal(s2.body.skipped, undefined);
    assert.ok(blastClaimed(calls));
  });

  it("auth is checked before the window: a wrong secret is refused at any hour, with no database call", async () => {
    at("2026-10-14T07:30:00Z");
    const calls = neonCounter();
    assert.equal((await run(sweep, { auth: "Bearer wrong" })).status, 401);
    assert.equal((await run(sendScheduled, { auth: "Bearer wrong" })).status, 401);
    delete process.env.CRON_SECRET;
    assert.equal((await run(sweep)).status, 503);
    assert.equal((await run(sendScheduled)).status, 503);
    assert.deepEqual(calls, []);
  });

  it("the window boundaries, summer and winter", () => {
    const cases: Array<[string, string, boolean, boolean]> = [
      // [instant, label, sweep open?, blast open?]
      ["2026-10-14T13:40:00Z", "Wed 9:40 AM EDT", false, false],
      ["2026-10-14T14:00:00Z", "Wed 10:00 AM EDT", true, true],
      ["2026-10-15T02:40:00Z", "Wed 10:40 PM EDT", true, true],
      ["2026-10-15T03:00:00Z", "Wed 11:00 PM EDT (counter and ordering closed)", true, false],
      ["2026-10-15T03:40:00Z", "Wed 11:40 PM EDT (last tail tick)", true, false],
      ["2026-10-15T04:00:00Z", "Thu 12:00 AM EDT", false, false],
      ["2026-10-18T03:40:00Z", "Sat 11:40 PM EDT (counter open to midnight)", true, true],
      ["2026-10-18T04:00:00Z", "Sun 12:00 AM EDT", false, false],
      ["2026-12-09T14:40:00Z", "Wed 9:40 AM EST (the schedule fires, the gate holds)", false, false],
      ["2026-12-09T15:00:00Z", "Wed 10:00 AM EST", true, true],
      ["2026-12-10T03:40:00Z", "Wed 10:40 PM EST", true, true],
      ["2026-12-10T04:00:00Z", "Wed 11:00 PM EST", true, false],
      ["2026-12-10T04:40:00Z", "Wed 11:40 PM EST (last tail tick)", true, false],
      ["2026-12-10T05:00:00Z", "Thu 12:00 AM EST", false, false],
      ["2026-12-13T04:40:00Z", "Sat 11:40 PM EST", true, true],
      ["2026-12-13T05:00:00Z", "Sun 12:00 AM EST", false, false],
    ];
    for (const [iso, label, sweepOpen, blastOpen] of cases) {
      at(iso);
      assert.equal(sweepWindowOpen(), sweepOpen, `sweep at ${label}`);
      assert.equal(blastWindowOpen(), blastOpen, `blast at ${label}`);
    }
    assert.equal(SWEEP_TAIL_MINUTES, 45, "5-minute order grace + 25-minute stuck threshold + one tick, short of midnight");
  });

  it("the vercel.json schedule fires on every open tick, with the expected count per local day", () => {
    const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as { crons: { path: string; schedule: string }[] };
    // Expected open ticks per local day, by weekday (Sun=0).
    const windows = {
      "/api/cron/sweep-prints": { open: sweepWindowOpen, perDay: [42, 42, 42, 42, 42, 42, 42] },
      "/api/cron/send-scheduled": { open: blastWindowOpen, perDay: [42, 39, 39, 39, 42, 42, 42] },
    };
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
    for (const [path, w] of Object.entries(windows)) {
      const cron = vercel.crons.find((c) => c.path === path);
      assert.ok(cron, `${path} is scheduled`);
      const [minutes, hours] = cron.schedule.split(" ");
      assert.equal(minutes, "*/20", `${path} runs every 20 minutes`);
      assert.match(hours, /^\d+(-\d+)?(,\d+(-\d+)?)*$/, "this test only understands comma-separated UTC hour ranges");
      const hourSet = new Set<number>();
      for (const part of hours.split(",")) {
        const [a, b] = part.split("-").map(Number);
        for (let h = a; h <= (b ?? a); h++) hourSet.add(h);
      }
      // A mid-summer week, a mid-winter week, and the weeks of the two daylight-saving switches
      // (2026-11-01 and 2027-03-14), each given by its Monday. Every 20-minute UTC tick from half a
      // day before to half a day after the week is bucketed by its LOCAL date, so the count for
      // each of the seven local days is exact even when the clocks change. None of these weeks
      // holds a CLOSED_DATES day.
      for (const monday of ["2026-07-13", "2026-12-07", "2026-10-26", "2027-03-08"]) {
        const start = new Date(`${monday}T00:00:00Z`).getTime() - 12 * 3600_000;
        const end = start + (7 * 24 + 24) * 3600_000;
        const perDate = new Map<string, number>();
        for (let ms = start; ms < end; ms += 20 * 60_000) {
          at(new Date(ms).toISOString());
          const open = w.open();
          const day = localDate.format(new Date(ms));
          mock.timers.reset();
          if (!open) continue;
          perDate.set(day, (perDate.get(day) ?? 0) + 1);
          const h = new Date(ms).getUTCHours();
          assert.ok(hourSet.has(h), `${path}: open at ${new Date(ms).toISOString()} but the schedule skips UTC hour ${h}`);
        }
        for (let d = 0; d < 7; d++) {
          const date = new Date(`${monday}T12:00:00Z`);
          date.setUTCDate(date.getUTCDate() + d);
          const key = date.toISOString().slice(0, 10);
          const weekday = (d + 1) % 7; // Monday = 1 ... Sunday = 0
          assert.equal(perDate.get(key) ?? 0, w.perDay[weekday], `${path}: open ticks on ${key}`);
        }
      }
    }
  });
});
