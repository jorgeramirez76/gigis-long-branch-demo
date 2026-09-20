import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
process.env.DATABASE_URL = "postgres://test:test@fake-neon.test/test";
process.env.CRON_SECRET = "cron-test-secret";
process.env.RESEND_API_KEY = "re_test";
process.env.EMAIL_FROM = "Gigi's <hello@gigislongbranch.com>";
process.env.UNSUB_SECRET = "unsub-test";
process.env.PUBLIC_BASE_URL = "https://gigislongbranch.com";
import handler from "../api/cron/send-scheduled.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function response() {
  const state: { status: number; body: Record<string, unknown> } = { status: 0, body: {} };
  return { state, res: { status(n: number) { state.status = n; return this; }, json(v: Record<string, unknown>) { state.body = v; return this; }, setHeader() { return this; } } };
}
const request = (auth = "Bearer cron-test-secret") => ({ method: "GET", headers: { authorization: auth, "user-agent": "vercel-cron/1.0" }, query: {}, body: {} });

const REQ = "12345678-1234-4123-8123-123456789abc";

/** Neon-over-HTTP fixture: answers each query by substring, the way tests/broadcast-reservation does. */
function storage() {
  const log: string[] = [];
  const emails: string[] = [];
  let claimed = false;
  let finished: Record<string, unknown> | null = null;
  let broadcastStarted = false;
  function result(data: Record<string, unknown>[] = []) {
    const names = Object.keys(data[0] ?? {});
    return new Response(JSON.stringify({ command: "SELECT", rowCount: data.length, fields: names.map((name) => ({ name, dataTypeID: typeof data[0]?.[name] === "number" ? 23 : typeof data[0]?.[name] === "boolean" ? 16 : 25 })), rows: data.map((r) => names.map((n) => (typeof r[n] === "boolean" ? (r[n] ? "t" : "f") : r[n]))) }));
  }
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("api.resend.com")) { emails.push(...[JSON.parse(String(init?.body)).to].flat()); return new Response(JSON.stringify({ id: "email-fixture" })); }
    assert.ok(u.includes("neon") || u.includes("api.test"), `unexpected provider call ${u}`);
    const { query: q, params: p } = JSON.parse(String(init?.body));
    log.push(q.replace(/\s+/g, " ").slice(0, 60));
    if (q.includes("UPDATE scheduled_broadcasts SET started_at")) {
      if (claimed) return result();
      claimed = true;
      return result([{ id: 7, business: "gigis_long_branch", subject: "Sunday only", message: "BOGO today", want_sms: false, want_email: true, send_at: "2026-09-20T15:00:00Z", request_id: REQ }]);
    }
    if (q.includes("UPDATE scheduled_broadcasts SET finished_at")) { finished = JSON.parse(p[0]); return result(); }
    if (q.includes("FROM vip_members")) return result([{ id: 1, name: "Fixture", phone: null, email: "vip@example.com" }]);
    if (q.includes("LEFT JOIN vip_sends")) return result(broadcastStarted ? [{ id: 3, content_key: "k", delivery_started_at: "x", completed_at: null, sms_sent: 0, sms_failed: 0, email_sent: 0, email_failed: 0 }] : []);
    if (q.includes("SELECT b.id FROM broadcasts")) return result();
    if (q.includes("INSERT INTO broadcasts")) { assert.equal(p[7], REQ, "the row's request_id is the send core's dedupe key"); return result([{ id: 3 }]); }
    if (q.includes("SET delivery_started_at")) { broadcastStarted = true; return result([{ id: 3 }]); }
    return result();
  };
  return { log, emails, get finished() { return finished; } };
}

test("the cron refuses anything but the cron secret", async () => {
  const { state, res } = response();
  await handler(request("Bearer wrong") as never, res as never);
  assert.equal(state.status, 401);
});

test("a due row is claimed once, sent through the shared broadcast core, and its outcome recorded", async () => {
  const s = storage();
  const { state, res } = response();
  await handler(request() as never, res as never);
  assert.equal(state.status, 200);
  assert.deepEqual(s.emails, ["vip@example.com"], "exactly the consenting member, once");
  assert.equal((state.body.sent as unknown[]).length, 1);
  assert.equal(s.finished?.status, 200);
  assert.equal(s.finished?.emailSent, 1);
  assert.ok(s.log.some((q) => q.includes("INSERT INTO vip_sends")), "audit row written like a dashboard blast");
});

test("a second tick finds nothing to send", async () => {
  const s = storage();
  await handler(request() as never, response().res as never);
  const { state, res } = response();
  await handler(request() as never, res as never);
  assert.equal(state.status, 200);
  assert.deepEqual(state.body.sent, []);
  assert.equal(s.emails.length, 1);
});
