import assert from 'node:assert/strict';
import { afterEach, describe, it, type TestContext } from 'node:test';
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
delete process.env.CLOVER_ECOMM_PRIVATE_TOKEN;
delete process.env.CLOVER_PRINT_DEVICE_IDS;
delete process.env.CARD_PAYMENTS_OFF;
delete process.env.VITE_CARD_PAYMENTS_OFF;
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function rows(data: Record<string, unknown>[] = [], count = data.length) {
  const keys = Object.keys(data[0] ?? {});
  return new Response(JSON.stringify({ command: 'SELECT', rowCount: count,
    fields: keys.map((name) => ({ name, dataTypeID: typeof data[0][name] === 'number' ? 23 : 25 })),
    rows: data.map((row) => keys.map((key) => (row[key] == null ? null : String(row[key])))) }), { status: 200 });
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Drive mocked setTimeout until the promise settles. */
async function pump<T>(t: TestContext, promise: Promise<T>): Promise<T> {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  while (!done) {
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(50);
  }
  return promise;
}
const order = (key: string) => ({
  method: 'POST', headers: {}, body: {
    idempotencyKey: key, fulfillment: 'pickup',
    customer: { name: 'Test customer', phone: '7325550100', email: 'test@example.com' },
    lines: [{ itemName: 'Plain Pie', categoryId: 'pizza', quantity: 1 }],
    cardToken: 'clv_test', paymentMethod: 'card', expectedTotal: 1885,
  },
});
function response() {
  const state: { code: number; body: Record<string, unknown> } = { code: 0, body: {} };
  return { state, res: { setHeader() { return this; }, status(v: number) { state.code = v; return this; }, json(v: Record<string, unknown>) { state.body = v; return this; } } };
}

describe('the paid order tail', () => {
  it('arms paid_print_queued before the print wait, polls only briefly, and runs no inline sweep', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-09-12T16:00:00Z') });
    const events: string[] = [];
    const sms: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url); const method = init?.method ?? 'GET';
      if (u.includes('api.twilio.com')) { sms.push(String(new URLSearchParams(String(init?.body)).get('Body'))); return json({ sid: 'SM1' }, 201); }
      if (u.includes('clover.com')) {
        const path = new URL(u).pathname.replace('/v3/merchants/test-merchant', '');
        events.push(`clover ${method} ${path}`);
        assert.ok(init?.signal instanceof AbortSignal, `${method} ${path} has no timeout`);
        if (path === '/v1/orders/DRAFT1') return json({ items: [{ amount: 1885 }] });
        if (path.endsWith('/pay')) return json({ id: 'CHG1', status: 'paid', paid: true, captured: true });
        if (path === '/print_event' && method === 'POST') return json({ id: 'EV1', state: 'CREATED' });
        if (path === '/print_event/EV1') return json({ state: 'CREATED' });
        if (path === '/orders' && method === 'POST') return json({ id: 'DRAFT1' });
        return json({ id: 'LI1' });
      }
      const { query: q, params: p } = JSON.parse(String(init?.body)) as { query: string; params: unknown[] };
      if (/UPDATE web_orders SET/.test(q)) events.push(`ledger status=${p[0] ?? '-'}`);
      if (q.includes('INSERT INTO web_orders')) return rows([{ id: 11 }]);
      if (q.includes('RETURNING n')) return rows([{ n: 1 }]);
      if (/^\s*(UPDATE|DELETE|CREATE|ALTER|INSERT)/.test(q)) return rows([{ id: 11 }], 1);
      return rows();
    }) as typeof fetch;
    const create = (await import('../api/order/create.js')).default;
    const r = response();
    await pump(t, create(order('11111111-2222-4333-8444-999999999991') as never, r.res as never));

    assert.equal(r.state.code, 200, JSON.stringify(r.state.body));
    assert.equal(r.state.body.paid, true);
    assert.equal(r.state.body.routingIssue, undefined, 'a ticket still in Clover\'s queue is normal, not a problem');
    assert.equal(events.find((e) => e.startsWith('clover')), 'clover POST /orders', 'no Clover call for other orders before this customer\'s draft');
    const armed = events.indexOf('ledger status=paid_print_queued');
    const printed = events.indexOf('clover POST /print_event');
    assert.ok(armed > events.indexOf('clover POST /orders/DRAFT1'), 'armed after the fire');
    assert.ok(armed >= 0 && armed < printed, `the queued handoff is written before the printer wait: ${events.join(' | ')}`);
    assert.ok(events.filter((e) => e === 'clover GET /print_event/EV1').length <= 4, 'the checkout waits only a few seconds for paper');
    assert.deepEqual(sms, [], 'a queued ticket pages nobody — the sweep decides it later');
  });
});

describe('free-pie replays never talk about a card', () => {
  it('a retry of a free order whose fire is unconfirmed is told to call — not "charged twice"', async () => {
    const sms: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('api.twilio.com')) { sms.push(String(new URLSearchParams(String(init?.body)).get('Body'))); return json({ sid: 'SM1' }, 201); }
      if (u.includes('clover.com')) throw new Error('no Clover call expected on a replay');
      const { query: q } = JSON.parse(String(init?.body)) as { query: string };
      if (q.includes('FROM web_orders WHERE idempotency_key')) return rows([{ id: 7, status: 'routing_uncertain', charge_id: null, clover_order_id: 'FREE1', age: 400 }]);
      if (q.includes('RETURNING n')) return rows([{ n: 1 }]);
      return rows([], 1);
    }) as typeof fetch;
    const create = (await import('../api/order/create.js')).default;
    const r = response();
    await create(order('11111111-2222-4333-8444-999999999992') as never, r.res as never);
    assert.equal(r.state.code, 409, JSON.stringify(r.state.body));
    assert.match(String(r.state.body.message), /reached the kitchen/);
    assert.doesNotMatch(String(r.state.body.message), /charged/);
    assert.equal(sms.length, 1);
    assert.match(sms[0], /FREE VIP PIE ORDER NOT CONFIRMED/);
    assert.doesNotMatch(sms[0], /payment/i);
  });
});

describe('strand reminders reach the rows that used to wait for the morning digest', () => {
  it('a pending row holding a Clover order and an unconfirmed free order each get one worded reminder', async () => {
    const sms: string[] = [];
    let strandQuery = '';
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('api.twilio.com')) { sms.push(String(new URLSearchParams(String(init?.body)).get('Body'))); return json({ sid: 'SM1' }, 201); }
      const { query: q } = JSON.parse(String(init?.body)) as { query: string };
      if (q.includes('FROM web_orders') && q.includes('ORDER BY created_at ASC LIMIT 25')) {
        strandQuery = q;
        return rows([
          { id: 21, status: 'pending', charge_id: null, clover_order_id: 'DRAFT21', customer_name: 'Pat', total: 2400 },
          { id: 22, status: 'routing_uncertain', charge_id: null, clover_order_id: 'FREE22', customer_name: 'Sam', total: 0 },
        ]);
      }
      if (q.includes('RETURNING n')) return rows([{ n: 1 }]);
      return rows([], 1);
    }) as typeof fetch;
    const { remindStrandedOrders } = await import('../api/lib/printSweep.js');
    const out = await remindStrandedOrders();
    assert.match(strandQuery, /status = 'pending' AND clover_order_id IS NOT NULL/);
    assert.match(strandQuery, /'routing_uncertain'/);
    assert.equal(out.reminded, 2);
    assert.match(sms[0], /DRAFT21/);
    assert.match(sms[0], /may hold a payment — or may be an unpaid leftover draft/);
    assert.match(sms[1], /free VIP pie web order for Sam \(nothing owed\)/);
    assert.doesNotMatch(sms[1], /charged/);
  });
});

describe('Clover calls carry timeouts', () => {
  it('REST, ecommerce reads and /pay all pass an abort signal', async () => {
    const clover = await import('../api/lib/clover.js');
    const seen: Array<{ url: string; signal: unknown }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), signal: init?.signal });
      if (String(url).endsWith('/pay')) return json({ id: 'CHG1', status: 'paid', paid: true });
      if (String(url).includes('/v1/orders/')) return json({ items: [{ amount: 500 }] });
      return json({});
    }) as typeof fetch;
    process.env.CLOVER_ECOMM_PRIVATE_TOKEN = 'test-ecomm';
    try {
      await clover.fireOrder('O1', { paid: true });
      await clover.getEcommOrderAmount('O1', 500);
      await clover.payForOrder({ orderId: 'O1', source: 'clv_test', idempotencyKey: '11111111-2222-4333-8444-999999999993' });
    } finally {
      delete process.env.CLOVER_ECOMM_PRIVATE_TOKEN;
    }
    assert.equal(seen.length, 3);
    for (const call of seen) assert.ok(call.signal instanceof AbortSignal, `${call.url} has no timeout`);
    assert.ok(clover.PAY_TIMEOUT_MS >= 20_000, '/pay keeps a generous ceiling — a timeout there means "uncertain"');
  });
});
