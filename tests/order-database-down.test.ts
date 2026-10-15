import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
// Same harness as tests/clover-rate-limit.test.ts ('checkout when Clover keeps throttling').
process.env.DATABASE_URL = 'postgres://user:pass@fake-neon.test/dbname';
process.env.CLOVER_API_TOKEN = 'test-only';
process.env.CLOVER_MERCHANT_ID = 'test-merchant';
process.env.STAFF_ALERT_PHONE = '+15555550123';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_API_KEY_SID = 'SKtest';
process.env.TWILIO_API_KEY_SECRET = 'test-secret';
process.env.TWILIO_FROM_NUMBER = '+15555550100';
delete process.env.TURNSTILE_SECRET_KEY;
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const KEY = '11111111-2222-4333-8444-777777777777';
const order = () => ({
  method: 'POST', headers: {}, body: {
    idempotencyKey: KEY, fulfillment: 'pickup',
    customer: { name: 'Test customer', phone: '7325550100', email: 'test@example.com' },
    lines: [{ itemName: 'Plain Pie', categoryId: 'pizza', quantity: 1 }],
    cardToken: 'clv_test', paymentMethod: 'card', expectedTotal: 1885,
  },
});
function response() {
  const state: { code: number; body: Record<string, unknown> } = { code: 0, body: {} };
  return { state, res: { setHeader() { return this; }, status(v: number) { state.code = v; return this; }, json(v: Record<string, unknown>) { state.body = v; return this; } } };
}

describe('checkout while the order database is unreachable', () => {
  it('answers a readable 503, pages staff once, and never reaches Clover', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-12T16:00:00Z') });
    const sms: string[] = [];
    const clover: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('api.twilio.com')) {
        sms.push(String(new URLSearchParams(String(init?.body)).get('Body')));
        return new Response(JSON.stringify({ sid: 'SMtest' }), { status: 201 });
      }
      if (u.includes('clover.com')) { clover.push(u); return new Response('{}'); }
      // Every Neon query fails, as during an outage or a suspended Free-plan compute.
      throw new TypeError('fetch failed (mock Neon outage)');
    }) as typeof fetch;
    const create = (await import('../api/order/create.js')).default;

    const first = response();
    await create(order() as never, first.res as never);
    assert.equal(first.state.code, 503, JSON.stringify(first.state.body));
    assert.equal(first.state.body.error, 'ordering_temporarily_unavailable');
    assert.match(String(first.state.body.message), /call the store/);
    assert.equal(sms.length, 1, 'staff are paged that online ordering is down');
    assert.match(sms[0], /ONLINE ORDERING IS DOWN/);

    // The page's own cooldown lives in the dead database and fails open, so a second refused
    // customer must not text staff again.
    const second = response();
    await create(order() as never, second.res as never);
    assert.equal(second.state.code, 503);
    assert.equal(sms.length, 1, 'one page per outage per instance, not one per checkout attempt');
    assert.deepEqual(clover, [], 'no Clover call — nothing can be charged without the ledger');
  });
});

describe('checkout reads the order response safely', () => {
  it('treats a non-JSON body as an unknown outcome (freeze + same-key retry), never as a raw parse error', () => {
    const file = readFileSync(new URL('../src/ordering/Checkout.tsx', import.meta.url), 'utf8');
    const src = file.slice(file.indexOf('async function sendOrder('), file.indexOf('function failOrder('));
    assert.ok(src.length > 0);
    assert.ok(!/const data = await res\.json\(\);/.test(src), 'a bare res.json() shows "Unexpected token" to customers');
    assert.match(src, /res\.json\(\)\.catch\(\(e: unknown\) => \{\s*throw e instanceof Error && e\.name === "AbortError" \? e : new TypeError\("unreadable order response"\);/);
    // ...and a TypeError is exactly what the catch freezes on.
    assert.match(src, /if \(e instanceof TypeError\) \{\s*setAttemptUncertain\(true\);/);
  });
});
