import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
process.env.DATABASE_URL = "postgres://test:test@fake-neon.test/test";
process.env.ADMIN_TOKEN = "quiet-hours-test-token";
process.env.CRON_SECRET = "cron-test-secret";
process.env.TWILIO_ACCOUNT_SID = "test-account";
process.env.TWILIO_AUTH_TOKEN = "test-secret";
process.env.TWILIO_FROM_NUMBER = "+15551230001";
const { smsSendWindowOpen } = await import("../api/lib/smsWindow.ts");
const broadcast = (await import("../api/admin/broadcast.ts")).default;
const sendScheduled = (await import("../api/cron/send-scheduled.ts")).default;
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; mock.timers.reset(); });

test("texts may start 9:00 AM to 8:29 PM in New York, summer and winter alike", () => {
  const at = (iso: string) => smsSendWindowOpen(new Date(iso));
  // EDT (UTC-4)
  assert.equal(at("2026-09-20T12:59:00Z"), false, "8:59 AM");
  assert.equal(at("2026-09-20T13:00:00Z"), true, "9:00 AM");
  assert.equal(at("2026-09-21T00:29:00Z"), true, "8:29 PM");
  assert.equal(at("2026-09-21T00:30:00Z"), false, "8:30 PM");
  assert.equal(at("2026-09-21T03:00:00Z"), false, "11 PM");
  // EST (UTC-5): the same local hours, different UTC hours
  assert.equal(at("2026-12-01T13:59:00Z"), false, "8:59 AM EST");
  assert.equal(at("2026-12-01T14:00:00Z"), true, "9:00 AM EST");
  assert.equal(at("2026-12-02T01:29:00Z"), true, "8:29 PM EST");
  assert.equal(at("2026-12-02T01:30:00Z"), false, "8:30 PM EST");
});

function storage() {
  const queries: { query: string; params: unknown[] }[] = [];
  const texts: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("api.twilio.com")) { texts.push(String(url)); return new Response(JSON.stringify({ sid: "SM1" })); }
    const body = JSON.parse(String(init?.body)) as { query: string; params: unknown[] };
    queries.push(body);
    const member = body.query.includes("FROM vip_members");
    return new Response(JSON.stringify({ command: "SELECT", rowCount: member ? 1 : 0,
      fields: member ? ["id", "name", "phone", "email"].map((name) => ({ name, dataTypeID: name === "id" ? 23 : 25 })) : [],
      rows: member ? [["1", "Fixture", "+15551230000", null]] : [] }));
  }) as typeof fetch;
  return { queries, texts };
}
async function blast(dryRun: boolean) {
  let code = 0; let body: Record<string, unknown> = {};
  const res = { setHeader() { return this; }, status(v: number) { code = v; return this; }, json(v: Record<string, unknown>) { body = v; return this; } };
  await broadcast({ method: "POST", headers: { "x-admin-token": "quiet-hours-test-token" }, query: {}, body: {
    business: "gigis_long_branch", message: "Late night test", channels: { sms: true, email: false },
    requestId: "12345678-1234-4123-8123-1234567890ab", dryRun,
  } } as never, res as never);
  return { code, body };
}

test("a hand-fired text blast at 10 PM is refused before anything is reserved or sent", async () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-21T02:00:00Z") }); // 10 PM EDT
  const db = storage();
  const preview = await blast(true);
  assert.equal(preview.code, 200);
  assert.equal(preview.body.smsWindowOpen, false, "the dry run warns before Send is pressed");
  const sent = await blast(false);
  assert.equal(sent.code, 409);
  assert.equal(sent.body.error, "sms_quiet_hours");
  assert.deepEqual(db.texts, []);
  assert.ok(!db.queries.some((q) => q.query.includes("INSERT INTO broadcasts")), "nothing reserved, so it can be sent tomorrow");
});

test("the scheduled queue leaves text blasts unclaimed outside the window", async () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-21T03:30:00Z") }); // 11:30 PM EDT
  const db = storage();
  let code = 0;
  const res = { setHeader() { return this; }, status(v: number) { code = v; return this; }, json() { return this; } };
  await sendScheduled({ method: "GET", headers: { authorization: "Bearer cron-test-secret", "user-agent": "vercel-cron/1.0" }, query: {}, body: {} } as never, res as never);
  assert.equal(code, 200);
  const claim = db.queries.find((q) => q.query.includes("UPDATE scheduled_broadcasts SET started_at"));
  assert.ok(claim, "the claim still runs (email-only rows may go)");
  assert.match(claim!.query, /AND \(NOT want_sms OR \$\d+\)/);
  assert.ok(claim!.params.map(String).some((p) => p === "false" || p === "f"), `outside the window the SMS clause is false: ${JSON.stringify(claim!.params)}`);
});
