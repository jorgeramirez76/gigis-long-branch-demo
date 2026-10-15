import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
// Same harness as tests/order-database-down.test.ts, except the database is UP for everything
// but the campaign code lookup: a transient Neon error in the middle of a checkout, not an outage.
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

const KEY = '11111111-2222-4333-8444-999999999999';
const order = () => ({
  method: 'POST', headers: {}, body: {
    idempotencyKey: KEY, fulfillment: 'pickup', promoCode: 'THANKYOU',
    customer: { name: 'Test customer', phone: '7325550100', email: 'test@example.com' },
    lines: [{ itemName: 'Plain Pie', categoryId: 'pizza', quantity: 1 }],
    cardToken: 'clv_test', paymentMethod: 'card', expectedTotal: 1885,
  },
});
function response() {
  const state: { code: number; body: Record<string, unknown> } = { code: 0, body: {} };
  return { state, res: { setHeader() { return this; }, status(v: number) { state.code = v; return this; }, json(v: Record<string, unknown>) { state.body = v; return this; } } };
}
function rows(data: Record<string, unknown>[] = []) {
  const keys = Object.keys(data[0] ?? {});
  return new Response(JSON.stringify({ command: 'SELECT', rowCount: data.length,
    fields: keys.map((name) => ({ name, dataTypeID: typeof data[0][name] === 'number' ? 23 : 25 })),
    rows: data.map((row) => keys.map((key) => (row[key] == null ? null : String(row[key])))) }), { status: 200 });
}

describe('checkout while the campaign code lookup fails', () => {
  it('answers the readable 503, pages staff, and neither reserves nor reaches Clover', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-17T16:00:00Z') });
    const sms: string[] = [];
    const clover: string[] = [];
    const queries: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('api.twilio.com')) {
        sms.push(String(new URLSearchParams(String(init?.body)).get('Body')));
        return new Response(JSON.stringify({ sid: 'SMtest' }), { status: 201 });
      }
      if (u.includes('clover.com')) { clover.push(u); return new Response('{}'); }
      const q = (JSON.parse(String(init?.body)) as { query: string }).query;
      queries.push(q);
      // Only the code lookup hiccups; the ledger, the rate limiter and the page cooldown all work.
      if (q.includes('FROM campaign_promos')) throw new TypeError('fetch failed (mock Neon hiccup)');
      if (q.includes('FROM web_orders WHERE idempotency_key')) return rows([]);
      if (q.includes('RETURNING n')) return rows([{ n: 1 }]);
      return rows();
    }) as typeof fetch;
    const create = (await import('../api/order/create.js')).default;

    const r = response();
    await create(order() as never, r.res as never);
    assert.equal(r.state.code, 503, JSON.stringify(r.state.body));
    assert.deepEqual(r.state.body, {
      error: 'ordering_temporarily_unavailable',
      message: 'Online ordering is temporarily unavailable. Please call the store at (732) 377-2468 to order.',
    });
    assert.ok(queries.some((q) => q.includes('FROM campaign_promos')), 'the code lookup was reached');
    assert.ok(!queries.some((q) => q.includes('INSERT INTO web_orders')), 'nothing is reserved');
    assert.ok(!queries.some((q) => q.includes('campaign_redemptions') && q.includes('INSERT')), 'no redemption is recorded');
    assert.deepEqual(clover, [], 'no Clover call — no draft, nothing charged');
    assert.equal(sms.length, 1, 'staff are paged, as for the ledger');
    assert.match(sms[0], /ONLINE ORDERING IS DOWN/);
  });
});
