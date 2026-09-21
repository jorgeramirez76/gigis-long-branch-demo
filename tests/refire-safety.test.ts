import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
process.env.DATABASE_URL = 'postgres://user:pass@fake-neon.test/dbname';
process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.CLOVER_API_TOKEN = 'test-only';
process.env.CLOVER_MERCHANT_ID = 'test-merchant';
process.env.CLOVER_ORDER_TYPE_PICKUP = 'test-pickup';
let originalFetch: typeof fetch;
let handler: typeof import('../api/admin/refire-order.js').default;
before(async () => { originalFetch = globalThis.fetch; handler = (await import('../api/admin/refire-order.js')).default; });
afterEach(() => { globalThis.fetch = originalFetch; });
function result(data: Record<string, unknown>[] = [], count = data.length) {
  const keys = Object.keys(data[0] ?? {});
  return new Response(JSON.stringify({ command: 'SELECT', rowCount: count,
    fields: keys.map(name => ({ name, dataTypeID: typeof data[0][name] === 'number' ? 23 : 25 })),
    rows: data.map(row => keys.map(key => row[key] == null ? null : String(row[key]))) }), { status: 200 });
}
function backend(claimDown = false) {
  let status = 'paid_unrouted'; let cloverCalls = 0;
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes('clover.com')) { cloverCalls++; throw new TypeError('simulated lost Clover response'); }
    const q = JSON.parse(String(init?.body)) as { query: string };
    if (q.query.includes('SET status = \'refire_pending\'')) {
      if (claimDown) throw new Error('simulated database unavailable');
      if (status !== 'paid_unrouted') return result();
      status = 'refire_pending'; return result([{ id: 11 }]);
    }
    if (/SELECT id, status, charge_id, clover_order_id, fulfillment/.test(q.query)) return result([{
      id: 11, status, charge_id: 'PAY1', clover_order_id: null, fulfillment: 'pickup',
      customer_name: 'Test customer', customer_phone: '7325550100', customer_email: null, address: null,
      items: JSON.stringify([{ itemName: 'Plain Pizza', basePrice: 2000, quantity: 1, options: [] }]),
      subtotal: 2000, card_pricing: 80, tax: 138, tip: 0, total: 2218, note: null,
      business: 'gigis_long_branch', fee_cents: 0, discount_cents: 0, town: null, promo_code: null,
    }]);
    if (/^(CREATE|ALTER)/.test(q.query.trim())) return result();
    throw new Error('Unexpected database query: ' + q.query);
  }) as typeof fetch;
  return { status: () => status, calls: () => cloverCalls };
}
async function run() {
  let code = 0; let body: Record<string, unknown> = {};
  const res = { setHeader() {}, status(value: number) { code = value; return this; }, json(value: Record<string, unknown>) { body = value; return this; } };
  await handler({ method: 'POST', headers: { 'x-admin-token': 'test-admin-token' }, body: { id: 11 } } as never, res as never);
  return { code, body };
}
describe('durable staff recovery', () => {
  it('blocks a second ticket after an interrupted first attempt', async () => {
    const state = backend();
    const first = await run();
    assert.equal(first.code, 502);
    assert.equal(state.status(), 'refire_pending');
    assert.equal(state.calls(), 1);
    const second = await run();
    assert.equal(second.code, 409);
    assert.equal(second.body.error, 'not_eligible');
    assert.equal(state.calls(), 1, 'retry must not contact Clover again');
  });
  it('never reaches Clover when its durable claim cannot be recorded', async () => {
    const state = backend(true);
    const response = await run();
    assert.equal(response.code, 409);
    assert.equal(state.calls(), 0);
    assert.equal(state.status(), 'paid_unrouted');
  });
});

describe('itemized total payment gate', () => {
  it('returns a recoverable error without any payment request when Clover disagrees', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-12T16:00:00Z') });
    process.env.ORDER_PROVIDER = 'inhouse';
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.CARD_PAYMENTS_OFF;
    delete process.env.VITE_CARD_PAYMENTS_OFF;
    const calls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      const u = String(url); const method = init?.method ?? 'GET';
      if (u.includes('clover.com')) {
        calls.push(method + ' ' + u);
        assert.ok(!/\/pay(?:$|\?)|\/charges(?:$|\?)/.test(u), 'mismatch must never reach a payment endpoint');
        if (u.includes('/v1/orders/')) return new Response(JSON.stringify({ items: [{ amount: 999999 }] }));
        return new Response(JSON.stringify({ id: 'DRAFT1' }));
      }
      const q = JSON.parse(String(init?.body)) as { query: string };
      if (q.query.includes('INSERT INTO web_orders')) return result([{ id: 11 }]);
      if (q.query.includes('INSERT INTO rate_counters')) return result([{ n: 1 }]);
      if (/^\s*(CREATE|ALTER|UPDATE|DELETE)/.test(q.query)) return result([], 1);
      if (/^\s*SELECT/.test(q.query)) return result();
      throw new Error('Unexpected mocked query ' + q.query);
    }) as typeof fetch;
    const create = (await import('../api/order/create.js')).default;
    let code = 0; let body: Record<string, unknown> = {};
    const res = { setHeader() {}, status(value: number) { code = value; return this; }, json(value: Record<string, unknown>) { body = value; return this; } };
    await create({ method: 'POST', headers: {}, body: {
      idempotencyKey: '11111111-2222-4333-8444-555555555555', fulfillment: 'pickup',
      customer: { name: 'Test customer', phone: '7325550100', email: 'test@example.com' },
      lines: [{ itemName: 'Plain Pie', categoryId: 'pizza', quantity: 1, selections: [] }],
      cardToken: 'clv_test', paymentMethod: 'card', expectedTotal: 1885,
    } } as never, res as never);
    assert.equal(code, 502, JSON.stringify(body));
    assert.equal(body.error, 'order_routing_failed');
    assert.ok(calls.some(call => call.startsWith('DELETE ')), 'unpaid mismatch draft is discarded');
    assert.ok(calls.some(call => call.includes('/v1/orders/')), 'Clover total was actually checked');
  });
});

describe('refired chit parity with the original', () => {
  // A refire rebuilds the kitchen note from the stored order, so anything the original chit
  // printed and the refire does not is context staff lose on the one ticket where the customer
  // is already waiting. The delivery TOWN was exactly that: api/order/create.ts passes
  // customer.town to buildOrderNote (it drives the "→ street, Town" line the driver reads for
  // the zone the fee was charged for), and the refire passed only the street.
  function deliveryBackend() {
    const notes: string[] = [];
    globalThis.fetch = (async (url, init) => {
      if (String(url).includes('clover.com')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { note?: string };
        if (typeof body.note === 'string') notes.push(body.note);
        throw new TypeError('simulated lost Clover response');
      }
      const q = JSON.parse(String(init?.body)) as { query: string };
      if (q.query.includes("SET status = 'refire_pending'")) return result([{ id: 12 }]);
      if (/SELECT id, status, charge_id, clover_order_id, fulfillment/.test(q.query)) return result([{
        id: 12, status: 'paid_unrouted', charge_id: 'PAY2', clover_order_id: null, fulfillment: 'delivery',
        customer_name: 'Delivery customer', customer_phone: '7325550101', customer_email: null,
        address: '12 Brighton Ave',
        items: JSON.stringify([{ itemName: 'Plain Pizza', basePrice: 2000, quantity: 1, options: [] }]),
        subtotal: 2000, card_pricing: 80, tax: 138, tip: 0, total: 2718, note: null,
        business: 'gigis_long_branch', fee_cents: 500, discount_cents: 0, town: 'Long Branch', promo_code: null,
      }]);
      if (/^(CREATE|ALTER|UPDATE)/.test(q.query.trim())) return result();
      throw new Error('Unexpected database query: ' + q.query);
    }) as typeof fetch;
    return notes;
  }

  it('prints the delivery town on the refired ticket, exactly as the original did', async () => {
    const notes = deliveryBackend();
    let code = 0;
    const res = { setHeader() {}, status(value: number) { code = value; return this; }, json() { return this; } };
    await handler({ method: 'POST', headers: { 'x-admin-token': 'test-admin-token' }, body: { id: 12 } } as never, res as never);
    assert.equal(code, 502);
    assert.equal(notes.length, 1, 'the refire built exactly one Clover order note');
    assert.ok(notes[0].includes('Addr: 12 Brighton Ave, Long Branch'),
      `refired delivery chit lost the town: ${notes[0]}`);
    assert.ok(notes[0].includes('REFIRED by staff'), 'the refire is still labelled for staff');
  });
});
