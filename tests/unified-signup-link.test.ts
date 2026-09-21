/**
 * ONE EMAIL, ONE LINK (2026-09-21).
 *
 * The owner's complaint was "back-and-forth with the emails": ticking the VIP box at checkout sent
 * "Tap to confirm your email", and then tapping "Create my account" on the very next screen sent a
 * SECOND "Finish your Gigi's Rewards account" link. Two emails, two links, one order.
 *
 * These tests pin the unified behaviour:
 *   (a) an account signup for an email that is already holding a live VIP verification link parks
 *       itself on that link and sends NOTHING;
 *   (b) the verification landing page hands the password step straight back, so that one link
 *       confirms the address, issues the free pie AND sets the password;
 *   (c) a member who verified the VIP link first is ATTACHED, never enrolled a second time;
 *   (d) the signup response never tells an anonymous caller which of those states an email is in.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ACCOUNT_ORIGIN } from "../api/lib/session.js";
import { accountHandler } from "../api/lib/accountHandler.js";
import { CANONICAL_CONSENT_TEXT } from "../api/lib/vipSignupShared.js";
import { finishEnrollment } from "../api/lib/accountStore.js";

process.env.DATABASE_URL = "postgres://test:test@fake-neon.test/test";
process.env.ACCOUNTS_ENABLED = "true";
process.env.TURNSTILE_SECRET_KEY = "test-secret";
process.env.RESEND_API_KEY = "test-resend-key";
process.env.EMAIL_FROM = "orders@gigislongbranch.test";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

type Call = { query: string; params: unknown[] };

/** Every outbound request is intercepted. Provider traffic is RECORDED, never allowed out — a
 *  test that quietly sent a real email would be exactly the bug under repair. */
function backend(rows: (query: string, params: unknown[]) => Record<string, unknown>[]) {
  const queries: Call[] = [];
  const providers: string[] = [];
  globalThis.fetch = (async (url, init) => {
    const target = String(url);
    if (target.includes("challenges.cloudflare.com")) return new Response(JSON.stringify({ success: true }));
    if (!target.includes("neon") && !target.includes("api.test")) {
      providers.push(target);
      return new Response(JSON.stringify({ id: "provider-message-id" }));
    }
    const body = JSON.parse(String(init?.body)) as Call;
    queries.push(body);
    const result = body.query.includes("RETURNING n") ? [{ n: 1 }] : rows(body.query, body.params);
    const keys = Object.keys(result[0] ?? {});
    // 3802 = jsonb, so the driver parses payload columns the way production does. Handing them
    // back as text would let a bug that reads a raw string sail through these tests.
    const oid = (key: string) => (key.endsWith("payload") ? 3802 : typeof result[0][key] === "number" ? 23 : 25);
    return new Response(JSON.stringify({
      command: "SELECT", rowCount: result.length,
      fields: keys.map((name) => ({ name, dataTypeID: oid(name) })),
      rows: result.map((row) => keys.map((key) => (row[key] == null ? null : String(row[key])))),
    }));
  }) as typeof fetch;
  return { queries, providers, ran: (needle: string) => queries.some((q) => q.query.includes(needle)) };
}

const response = () => {
  const state: { status: number; body: Record<string, unknown> } = { status: 0, body: {} };
  return { state, res: {
    status(n: number) { state.status = n; return this; },
    json(v: Record<string, unknown>) { state.body = v as Record<string, unknown>; return this; },
    setHeader() { return this; },
  } };
};

const SIGNUP_BODY = {
  name: "Jane Tester", email: "jane@example.com", phone: "(732) 555-0142",
  address: "12 Brighton Ave", city: "Long Branch", state: "NJ", zip: "07740",
  smsConsent: true, emailConsent: false, consentText: CANONICAL_CONSENT_TEXT,
  turnstileToken: "test-token",
};
const signupRequest = (over: Record<string, unknown> = {}) => ({
  method: "POST", query: {},
  headers: { origin: ACCOUNT_ORIGIN, "content-type": "application/json" },
  body: { ...SIGNUP_BODY, ...over },
});

test("a signup for an email already holding a VIP link rides on it — no second email, no second token", async () => {
  // The pending row accepts the attach, which is what "there is a live link in their inbox" means.
  const db = backend((query) => (query.includes("UPDATE vip_email_verifications") ? [{ id: 7 }] : []));
  const r = response();
  await accountHandler("signup")(signupRequest() as never, r.res as never);

  assert.equal(r.state.status, 200);
  assert.deepEqual(db.providers, [], "no email provider may be contacted — the customer already has the link");
  assert.ok(!db.ran("INSERT INTO account_tokens"), "no second link is minted while a live one exists");

  const attach = db.queries.find((q) => q.query.includes("UPDATE vip_email_verifications"));
  assert.ok(attach, "the account signup is parked on the pending verification");
  assert.ok(attach.query.includes("account_payload"));
  // The pending row must only be claimed while the link is genuinely still usable.
  assert.ok(attach.query.includes("verified_at IS NULL"));
  assert.ok(attach.query.includes("expires_at > now()"));
  // TCPA: the account form re-attests the SAME canonical text, so its ticks are the freshest
  // consent statement for this email and they are what completeSignup will record.
  assert.ok(attach.query.includes("jsonb_build_object('smsConsent'"));
  const sent = attach.params.map(String);
  assert.ok(sent.includes("true") && sent.includes("false"), "both consent ticks are carried, verbatim");
  // The parked profile is the whole validated signup, so the password step has everything it needs.
  const parked = JSON.parse(sent[0]) as Record<string, unknown>;
  assert.equal(parked.email, "jane@example.com");
  assert.equal(parked.zip, "07740");
  assert.equal(parked.source, "rewards-account");
  // The household fields belong to the signup that parked the row — the attach never rewrites them.
  assert.ok(!attach.query.includes("addr_key"));
  // Identity gate: a stranger who merely knows the email must not be able to rewrite the pending
  // consent flags or bury their own profile in the password step.
  assert.ok(attach.query.includes("payload->>'phone'"));
  assert.ok(sent.includes("+17325550142"));
});

test("a signup whose phone does not match the parked one is never allowed to rewrite it", async () => {
  // The UPDATE's own WHERE clause is the authority; here the database reports it matched nothing,
  // which is what a mismatched phone (or a link tapped in the meantime) looks like.
  const db = backend(() => []);
  const r = response();
  await accountHandler("signup")(signupRequest({ phone: "(732) 555-0999" }) as never, r.res as never);

  assert.equal(r.state.status, 200);
  assert.equal(db.providers.length, 1, "the customer gets their own link instead — never a silent no-op");
  assert.ok(db.ran("INSERT INTO account_tokens"));
});

test("with no live VIP link, the signup still sends exactly one link of its own", async () => {
  const db = backend((query) => (query.includes("UPDATE vip_email_verifications") ? [] : []));
  const r = response();
  await accountHandler("signup")(signupRequest({ email: "newcomer@example.com" }) as never, r.res as never);

  assert.equal(r.state.status, 200);
  assert.equal(db.providers.length, 1, "exactly one email");
  assert.ok(db.providers[0].includes("resend"));
  assert.equal(db.queries.filter((q) => q.query.includes("INSERT INTO account_tokens")).length, 1);
});

test("the signup answer is identical either way, so it cannot be used to probe an email", async () => {
  const withLink = response();
  backend((query) => (query.includes("UPDATE vip_email_verifications") ? [{ id: 7 }] : []));
  await accountHandler("signup")(signupRequest() as never, withLink.res as never);
  globalThis.fetch = originalFetch;

  const withoutLink = response();
  backend(() => []);
  await accountHandler("signup")(signupRequest({ email: "newcomer@example.com" }) as never, withoutLink.res as never);

  assert.deepEqual(withLink.state.body, withoutLink.state.body);
  assert.match(String(withLink.state.body.message), /one link/i, "and it tells the customer what to expect");
});

test("a bad profile or drifted consent text is still refused before anything is parked", async () => {
  for (const bad of [{ zip: "0774" }, { consentText: "old wording" }, { smsConsent: "true" }]) {
    const db = backend(() => []);
    const r = response();
    await accountHandler("signup")(signupRequest(bad) as never, r.res as never);
    assert.equal(r.state.status, 400, JSON.stringify(bad));
    assert.ok(!db.ran("UPDATE vip_email_verifications"), "nothing is parked on a rejected signup");
    globalThis.fetch = originalFetch;
  }
});

test("tapping the one link hands the password step straight back, instead of emailing another", async () => {
  const handler = (await import("../api/vip-verify.js")).default;
  const db = backend((query) => {
    if (query.includes("FROM vip_email_verifications WHERE secret_hash")) return [{
      id: 7, business: "gigis_long_branch", email: "jane@example.com", payload: "{}",
      expires_at: "2099-01-01T00:00:00Z", verified_at: "2026-09-21T12:00:00Z",
      issued_code: "PIE-ABC123", created_at: "2026-09-21T11:59:00Z",
    }];
    if (query.includes("SELECT account_payload")) return [{ account_payload: JSON.stringify({ name: "Jane Tester" }) }];
    return [];
  });
  const r = response();
  await handler({ method: "POST", headers: {}, body: { token: "T".repeat(43) } } as never, r.res as never);

  assert.equal(r.state.status, 200);
  assert.equal(r.state.body.code, "PIE-ABC123", "the free pie still comes back with it");
  assert.deepEqual(db.providers, [], "no second email is sent to set a password");
  const minted = db.queries.find((q) => q.query.includes("INSERT INTO account_tokens"));
  assert.ok(minted, "a one-time account link is minted for the person who just proved this inbox");
  assert.ok(minted.query.includes("'signup'"), "and it is a signup link, so enrollment finishes with the password");
  assert.ok(minted.query.includes("interval '30 minutes'"), "with the same short life as an emailed one");
  assert.match(String(r.state.body.accountPath), /^\/account\/#token=[A-Za-z0-9_-]{43}$/);
});

test("a verification with no account signup riding on it is unchanged", async () => {
  const handler = (await import("../api/vip-verify.js")).default;
  const db = backend((query) => {
    if (query.includes("FROM vip_email_verifications WHERE secret_hash")) return [{
      id: 8, business: "gigis_long_branch", email: "solo@example.com", payload: "{}",
      expires_at: "2099-01-01T00:00:00Z", verified_at: "2026-09-21T12:00:00Z",
      issued_code: "PIE-XYZ789", created_at: "2026-09-21T11:59:00Z",
    }];
    return [];
  });
  const r = response();
  await handler({ method: "POST", headers: {}, body: { token: "U".repeat(43) } } as never, r.res as never);

  assert.equal(r.state.status, 200);
  assert.equal(r.state.body.code, "PIE-XYZ789");
  assert.equal(r.state.body.accountPath, undefined, "nobody asked for an account, so none is offered");
  assert.ok(!db.ran("INSERT INTO account_tokens"));
});

test("an account for a member who already verified attaches — it never enrolls a second time", async () => {
  const enrollment = {
    name: "Jane Tester", phone: "+17325550142", email: "jane@example.com",
    fullAddress: "12 Brighton Ave, Long Branch, NJ 07740", apt: null,
    addrKey: "12brightonave|longbranch|nj|07740", smsConsent: true, emailConsent: false,
    source: "rewards-account", street: "12 Brighton Ave", city: "Long Branch", state: "NJ", zip: "07740",
  };
  const db = backend((query) => {
    if (query.includes("SELECT email,enrollment_payload")) return [{ email: "jane@example.com", enrollment_payload: JSON.stringify(enrollment) }];
    if (query.includes("SELECT 1 FROM vip_members")) return [{ "?column?": 1 }];
    if (query.includes("FROM vip_promo_codes c")) return [{ code: "PIE-ABC123", description: "one free plain cheese pie" }];
    return [];
  });
  await finishEnrollment(42);

  assert.ok(!db.ran("INSERT INTO vip_members"), "the household already claimed its welcome pie — no second enrollment");
  assert.deepEqual(db.providers, [], "and therefore no duplicate welcome email or text");
  assert.ok(db.ran("INSERT INTO saved_addresses"), "the address the customer typed is still saved");
  assert.ok(db.ran("UPDATE accounts a SET member_id=m.id"), "the verified membership is attached to the account");
  assert.ok(db.ran("UPDATE accounts SET enrollment_payload=NULL"), "and the enrollment is retired once");
});

test("an account for an email with no membership still enrolls normally", async () => {
  const enrollment = {
    name: "New Person", phone: "+17325550199", email: "new@example.com",
    fullAddress: "9 Ocean Ave, Long Branch, NJ 07740", apt: null,
    addrKey: "9oceanave|longbranch|nj|07740", smsConsent: false, emailConsent: false,
    source: "rewards-account", street: "9 Ocean Ave", city: "Long Branch", state: "NJ", zip: "07740",
  };
  const db = backend((query) => {
    if (query.includes("SELECT email,enrollment_payload")) return [{ email: "new@example.com", enrollment_payload: JSON.stringify(enrollment) }];
    if (query.includes("INSERT INTO vip_members")) return [{ id: 99 }];
    if (query.includes("INSERT INTO vip_promo_codes")) return [{ id: 5, code: "PIE-NEW111", description: "one free plain cheese pie" }];
    return [];
  });
  await finishEnrollment(43);

  assert.ok(db.ran("INSERT INTO vip_members"), "a genuinely new household is still enrolled");
  const insert = db.queries.find((q) => q.query.includes("INSERT INTO vip_members"));
  assert.ok(insert?.params.includes(CANONICAL_CONSENT_TEXT), "with the canonical consent text recorded verbatim");
  assert.ok(insert?.query.includes("WHERE NOT EXISTS"), "and the one-pie-per-household guard intact");
});
