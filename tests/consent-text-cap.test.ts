import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ACCOUNT_ORIGIN } from "../api/lib/session.js";
import { accountHandler } from "../api/lib/accountHandler.js";
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
/** Neon fixture with a real claimWindow table; `lastKeyword` is the member's latest STOP/START. */
function world(lastKeyword: "opt_out" | "opt_in" | null) {
  const texts: string[] = [];
  const claims = new Set<string>();
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("api.twilio.com")) { texts.push(String(new URLSearchParams(String(init?.body)).get("To"))); return new Response(JSON.stringify({ sid: "SM1" })); }
    assert.ok(String(url).includes("neon") || String(url).includes("api.test"), "unexpected provider call");
    const { query: q, params: p } = JSON.parse(String(init?.body)) as { query: string; params: unknown[] };
    let rows: Record<string, unknown>[] = [];
    if (q.includes("FROM account_sessions s JOIN accounts")) rows = [signedIn];
    else if (q.includes("SELECT * FROM updated")) rows = [{ id: 9, phone: "+15555550202", sms_requested: false, sms_consent: false }];
    else if (q.includes("source IN ('sms_stop','sms_start')")) rows = lastKeyword ? [{ action: lastKeyword }] : [];
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
  return texts;
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
  assert.deepEqual(texts, []);
});
