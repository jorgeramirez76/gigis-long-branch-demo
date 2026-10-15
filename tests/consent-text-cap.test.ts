import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ACCOUNT_ORIGIN } from "../api/lib/session.js";
import { accountHandler, CONSENT_TEXTS_PER_30_DAYS } from "../api/lib/accountHandler.js";
import { CANONICAL_CONSENT_TEXT } from "../api/lib/vipSignupShared.js";
process.env.DATABASE_URL = "postgres://test:test@fake-neon.test/test";
process.env.ACCOUNTS_ENABLED = "true";
process.env.TWILIO_ACCOUNT_SID = "ACtest";
process.env.TWILIO_API_KEY_SID = "SKtest";
process.env.TWILIO_API_KEY_SECRET = "test-secret";
process.env.TWILIO_FROM_NUMBER = "+15555550100";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const signedIn = { id: 7, name: "Example", email: "example@example.test", phone: "+15555550101", member_id: 9, password_hash: "unused" };
/** Neon fixture with a real claimWindow table and vip_sends log; `lastKeyword` is the member's
 *  latest STOP/START, `priorConfirmations` the consent texts already logged in the last 30 days,
 *  and `twilioFailures` how many sends Twilio refuses before it accepts one. */
function world(lastKeyword: "opt_out" | "opt_in" | null, opts: { priorConfirmations?: number; twilioFailures?: number } = {}) {
  const texts: string[] = [];
  const claims = new Set<string>();
  const logged: unknown[][] = [];
  let failures = opts.twilioFailures ?? 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("api.twilio.com")) {
      if (failures > 0) { failures--; return new Response("Service Unavailable", { status: 503 }); }
      texts.push(String(new URLSearchParams(String(init?.body)).get("To")));
      return new Response(JSON.stringify({ sid: "SM1" }));
    }
    assert.ok(String(url).includes("neon") || String(url).includes("api.test"), "unexpected provider call");
    const { query: q, params: p } = JSON.parse(String(init?.body)) as { query: string; params: unknown[] };
    let rows: Record<string, unknown>[] = [];
    if (q.includes("FROM account_sessions s JOIN accounts")) rows = [signedIn];
    else if (q.includes("SELECT * FROM updated")) rows = [{ id: 9, phone: "+15555550202", sms_requested: false, sms_consent: false }];
    else if (q.includes("source IN ('sms_stop','sms_start')")) rows = lastKeyword ? [{ action: lastKeyword }] : [];
    else if (q.includes("FROM vip_sends s JOIN vip_members")) rows = [{ n: (opts.priorConfirmations ?? 0) + logged.length }];
    else if (q.includes("INSERT INTO vip_sends")) logged.push(p);
    else if (q.includes("DELETE FROM rate_counters WHERE bucket")) claims.delete(`${p[0]}@${p[1]}`);
    else if (q.includes("RETURNING n") && q.includes("DO NOTHING")) {
      const key = `${p[0]}@${p[1]}`;
      rows = claims.has(key) ? [] : [{ n: 1 }];
      claims.add(key);
    } else if (q.includes("RETURNING n")) rows = [{ n: 1 }];
    const keys = Object.keys(rows[0] ?? {});
    return new Response(JSON.stringify({ command: "SELECT", rowCount: rows.length,
      fields: keys.map((name) => ({ name, dataTypeID: typeof rows[0][name] === "number" ? 23 : typeof rows[0][name] === "boolean" ? 16 : 25 })),
      rows: rows.map((row) => keys.map((k) => (typeof row[k] === "boolean" ? (row[k] ? "t" : "f") : row[k]))) }));
  }) as typeof fetch;
  return Object.assign(texts, { logged });
}
async function toggleTextsOn() {
  const state: { status: number; body: Record<string, unknown> } = { status: 0, body: {} };
  const res = { status(n: number) { state.status = n; return this; }, json(v: Record<string, unknown>) { state.body = v; return this; }, setHeader() { return this; } };
  await accountHandler("consent")({ method: "POST", headers: { origin: ACCOUNT_ORIGIN, "content-type": "application/json", cookie: "__Host-gigis_session=" + "B".repeat(43) }, query: {},
    body: { sms: true, email: true, consentText: CANONICAL_CONSENT_TEXT } } as never, res as never);
  return state;
}

test("toggling texts off and on sends at most one confirmation per phone per day", async () => {
  const texts = world(null);
  assert.equal((await toggleTextsOn()).status, 200);
  assert.equal(texts.length, 1, "the first request gets its confirmation");
  const again = await toggleTextsOn();
  assert.equal(again.status, 200, "the preference is still saved");
  assert.match(String(again.body.message), /already sent this number a confirmation text today/);
  assert.equal(texts.length, 1, "no second text to an unverified phone");
});

test("a number that texted STOP is not sent a confirmation Twilio would block", async () => {
  const texts = world("opt_out");
  const state = await toggleTextsOn();
  assert.equal(state.status, 200);
  assert.match(String(state.body.message), /text START/);
  assert.equal(texts.length, 0);
});

test("each confirmation is logged, and a phone gets at most 3 in 30 days", async () => {
  assert.equal(CONSENT_TEXTS_PER_30_DAYS, 3);
  const texts = world(null, { priorConfirmations: 2 });
  assert.equal((await toggleTextsOn()).status, 200);
  assert.equal(texts.length, 1, "the third confirmation in 30 days still goes out");
  assert.equal(texts.logged.length, 1, "and is written to vip_sends, which the cap counts");
  const capped = world(null, { priorConfirmations: 3 });
  const state = await toggleTextsOn();
  assert.equal(state.status, 200, "the preference is still saved");
  assert.match(String(state.body.message), /several confirmation texts this month/);
  assert.equal(capped.length, 0, "no fourth text that month, even on a new day");
});

test("a failed send hands the day's claim back, so the customer can try again", async () => {
  const texts = world(null, { twilioFailures: 1 });
  const failed = await toggleTextsOn();
  assert.equal(failed.status, 503);
  assert.equal(failed.body.error, "confirmation_unavailable");
  assert.equal(texts.logged.length, 0, "nothing sent, nothing counted");
  const retry = await toggleTextsOn();
  assert.equal(retry.status, 200, "not told it was already sent today");
  assert.equal(retry.body.message, undefined);
  assert.equal(texts.length, 1, "the retry reaches the phone");
});
