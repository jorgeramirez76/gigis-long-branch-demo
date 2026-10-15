import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { readFileSync } from 'node:fs';
// Same harness as tests/clover-rate-limit.test.ts ('checkout when Clover keeps throttling').
process.env.DATABASE_URL = 'postgres://user:pass@fake-neon.test/dbname';
process.env.CLOVER_API_TOKEN = 'test-only';
process.env.CLOVER_MERCHANT_ID = 'test-merchant';
delete process.env.TURNSTILE_SECRET_KEY;
const { CLOSED_DATES, closedTodayMessage, getOpenStatus, isDeliveryOpen, isOrderingOpen } = await import('../src/lib/openStatus.ts');

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.CARD_PAYMENTS_OFF;
  delete process.env.VITE_CARD_PAYMENTS_OFF;
  for (const day of Object.keys(CLOSED_DATES)) delete CLOSED_DATES[day];
  mock.timers.reset();
});

/** Noon on Saturday 2026-09-12 in New York: inside normal ordering hours. */
const NOON = new Date('2026-09-12T16:00:00Z');

function rows(data: Record<string, unknown>[] = []) {
  const keys = Object.keys(data[0] ?? {});
  return new Response(JSON.stringify({ command: 'SELECT', rowCount: data.length,
    fields: keys.map((name) => ({ name, dataTypeID: typeof data[0][name] === 'number' ? 23 : 25 })),
    rows: data.map((row) => keys.map((key) => (row[key] == null ? null : String(row[key])))) }), { status: 200 });
}
/** Neon over HTTP; `ledger` is the web_orders row (if any) every peek finds. */
function stub(ledger: Record<string, unknown> | null) {
  const clover: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('clover.com')) { clover.push(u); return new Response('{}'); }
    const q = (JSON.parse(String(init?.body)) as { query: string }).query;
    if (q.includes('FROM web_orders WHERE idempotency_key')) return rows(ledger ? [ledger] : []);
    if (q.includes('RETURNING n')) return rows([{ n: 1 }]);
    return rows();
  }) as typeof fetch;
  return clover;
}
const KEY = '11111111-2222-4333-8444-888888888888';
const order = () => ({
  method: 'POST', headers: {}, body: {
    idempotencyKey: KEY, fulfillment: 'pickup',
    customer: { name: 'Test customer', phone: '7325550100', email: 'test@example.com' },
    lines: [{ itemName: 'Plain Pie', categoryId: 'pizza', quantity: 1 }],
    cardToken: 'clv_test', paymentMethod: 'card', expectedTotal: 1885,
  },
});
async function post() {
  const create = (await import('../api/order/create.js')).default;
  let code = 0; let body: Record<string, unknown> = {};
  const res = { setHeader() { return this; }, status(v: number) { code = v; return this; }, json(v: Record<string, unknown>) { body = v; return this; } };
  await create(order() as never, res as never);
  return { code, body };
}

describe('closed dates (ported from Sea Bright)', () => {
  it('ships empty — holiday closures are the owner\'s call', () => {
    const src = readFileSync(new URL('../src/lib/openStatus.ts', import.meta.url), 'utf8');
    assert.match(src, /export const CLOSED_DATES: Record<string, string> = \{\};/);
  });

  it('a closed day takes no orders at an hour the shop is normally open, judged in New York time', () => {
    CLOSED_DATES['2026-11-26'] = 'Thanksgiving';
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-26T17:00:00Z') });
    assert.equal(isOrderingOpen(5), false);
    assert.equal(isDeliveryOpen(5), false);
    assert.deepEqual(getOpenStatus(), { open: false, label: 'Closed today', closingSoon: false });
    assert.match(closedTodayMessage() ?? '', /closed today for Thanksgiving/);
    mock.timers.reset();
    // 10:30 PM Wednesday in New York is already Thursday in UTC; Wednesday's hours still apply.
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-26T03:30:00Z') });
    assert.equal(isOrderingOpen(), true);
    assert.equal(closedTodayMessage(), null);
  });

  it('the order API refuses a new order on a closed day with the closed-day message', async () => {
    CLOSED_DATES['2026-09-12'] = 'a family event';
    mock.timers.enable({ apis: ['Date'], now: NOON });
    const clover = stub(null);
    const { code, body } = await post();
    assert.equal(code, 409, JSON.stringify(body));
    assert.equal(body.error, 'store_closed');
    assert.match(String(body.message), /closed today for a family event/);
    assert.deepEqual(clover, []);
  });
});

describe('server-side card kill switch (ported from Sea Bright)', () => {
  for (const name of ['CARD_PAYMENTS_OFF', 'VITE_CARD_PAYMENTS_OFF']) {
    it(`${name}=1 refuses a new order before any Clover call`, async () => {
      process.env[name] = '1';
      mock.timers.enable({ apis: ['Date'], now: NOON });
      const clover = stub(null);
      const { code, body } = await post();
      assert.equal(code, 503, JSON.stringify(body));
      assert.equal(body.error, 'card_payments_disabled');
      assert.match(String(body.message), /call \(732\) 377-2468/);
      assert.deepEqual(clover, [], 'nothing reaches Clover — no draft, no /pay');
    });
  }

  it('a frozen customer\'s replay of a placed order is still answered while the switch is on', async () => {
    process.env.CARD_PAYMENTS_OFF = '1';
    mock.timers.enable({ apis: ['Date'], now: NOON });
    const clover = stub({ id: 5, status: 'paid', charge_id: 'PAY1', clover_order_id: 'ORDER9', age: 30 });
    const { code, body } = await post();
    assert.equal(code, 200, JSON.stringify(body));
    assert.equal(body.duplicate, true);
    assert.equal(body.orderId, 'ORDER9');
    assert.deepEqual(clover, []);
  });

  it('the checkout offers no $0.00 path while the switch is on (the server would refuse it)', () => {
    const src = readFileSync(new URL('../src/ordering/Checkout.tsx', import.meta.url), 'utf8');
    assert.match(src, /const freeOrder = CARD_ENABLED && grandTotal === 0/);
    const comment = readFileSync(new URL('../src/ordering/cloverPayment.ts', import.meta.url), 'utf8');
    assert.ok(!/The server also enforces this switch; this build-time flag/.test(comment));
  });
});
