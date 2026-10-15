import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
process.env.DATABASE_URL = 'postgres://user:pass@fake-neon.test/dbname';
process.env.CLOVER_API_TOKEN = 'test-only';
process.env.CLOVER_MERCHANT_ID = 'test-merchant';
process.env.STAFF_ALERT_PHONE = '+15555550123';
process.env.STAFF_ALERT_EMAIL = 'staff@example.test';
process.env.DIGEST_EMAIL = 'owner@example.test';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_API_KEY_SID = 'SKtest';
process.env.TWILIO_API_KEY_SECRET = 'test-secret';
process.env.TWILIO_FROM_NUMBER = '+15555550100';
process.env.RESEND_API_KEY = 're_test';
process.env.EMAIL_FROM = "Gigi's <hello@example.test>";
delete process.env.OPS_ALERT_EMAIL;
delete process.env.TURNSTILE_SECRET_KEY;
delete process.env.CARD_PAYMENTS_OFF;
delete process.env.VITE_CARD_PAYMENTS_OFF;
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
function rows(data: Record<string, unknown>[] = [], count = data.length) {
  const keys = Object.keys(data[0] ?? {});
  return new Response(JSON.stringify({ command: 'SELECT', rowCount: count,
    fields: keys.map((name) => ({ name, dataTypeID: typeof data[0][name] === 'number' ? 23 : 25 })),
    rows: data.map((row) => keys.map((key) => (row[key] == null ? null : String(row[key])))) }), { status: 200 });
}

/** Providers recorded; Neon answered with a working rate_counters table. */
function world(clover: (method: string, path: string) => Response) {
  const sms: string[] = [];
  const email: { to: string; text: string }[] = [];
  const counters = new Map<string, number>();
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url); const method = init?.method ?? 'GET';
    if (u.includes('api.twilio.com')) { sms.push(String(new URLSearchParams(String(init?.body)).get('Body'))); return json({ sid: 'SM1' }, 201); }
    if (u.includes('api.resend.com')) { const b = JSON.parse(String(init?.body)); email.push({ to: b.to[0], text: b.text }); return json({ id: 'em1' }); }
    if (u.includes('clover.com')) return clover(method, new URL(u).pathname.replace('/v3/merchants/test-merchant', ''));
    const { query: q, params: p } = JSON.parse(String(init?.body)) as { query: string; params: unknown[] };
    if (q.includes('INSERT INTO rate_counters')) {
      const key = `${p[0]}@${p[1]}`;
      if (q.includes('DO NOTHING')) {
        if (counters.has(key)) return rows([], 0);
        counters.set(key, 1); return rows([{ n: 1 }]);
      }
      const n = (counters.get(key) ?? 0) + 1; counters.set(key, n); return rows([{ n }]);
    }
    if (q.includes('DELETE FROM rate_counters')) { counters.delete(`${p[0]}@${p[1]}`); return rows([], 1); }
    if (q.includes('INSERT INTO web_orders')) return rows([{ id: 11 }]);
    if (/^\s*(UPDATE|DELETE|CREATE|ALTER|INSERT)/.test(q)) return rows([{ id: 11 }], 1);
    return rows();
  }) as typeof fetch;
  return { sms, email };
}
let seq = 0;
async function checkout() {
  seq++;
  const create = (await import('../api/order/create.js')).default;
  let code = 0; let body: Record<string, unknown> = {};
  const res = { setHeader() { return this; }, status(v: number) { code = v; return this; }, json(v: Record<string, unknown>) { body = v; return this; } };
  await create({ method: 'POST', headers: {}, body: {
    idempotencyKey: `11111111-2222-4333-8444-${String(100000000000 + seq)}`, fulfillment: 'pickup',
    customer: { name: 'Test customer', phone: `73255${String(10000 + seq).slice(-5)}`, email: 'test@example.com' },
    lines: [{ itemName: 'Plain Pie', categoryId: 'pizza', quantity: 1 }],
    cardToken: 'clv_test', paymentMethod: 'card', expectedTotal: 1885,
  } } as never, res as never);
  return { code, body };
}

describe('money-at-risk pages go out on every channel', () => {
  it('a staff page emails even when Twilio accepted the text', async () => {
    const { sms, email } = world(() => json({}));
    const { alertStaff } = await import('../api/lib/notify.js');
    assert.equal(await alertStaff('PAID WEB ORDER NOT FIRED — test'), true);
    assert.equal(sms.length, 1);
    assert.deepEqual(email.map((e) => e.to), ['staff@example.test'], 'accepted by Twilio is not delivered — email every time');
  });
});

describe('developer-only problems email the owner and never text the store', () => {
  it('alertOps emails DIGEST_EMAIL (or OPS_ALERT_EMAIL) and sends no SMS', async () => {
    const { sms, email } = world(() => json({}));
    const { alertOps } = await import('../api/lib/notify.js');
    assert.equal(await alertOps('MENU PRICE DRIFT — test'), true);
    assert.deepEqual(sms, []);
    assert.deepEqual(email.map((e) => e.to), ['owner@example.test']);
    process.env.OPS_ALERT_EMAIL = 'dev@example.test';
    try {
      const again = world(() => json({}));
      await alertOps('MENU PRICE DRIFT — test');
      assert.deepEqual(again.email.map((e) => e.to), ['dev@example.test']);
    } finally { delete process.env.OPS_ALERT_EMAIL; }
  });

  it('the 4 AM menu cron no longer texts the store about drift or refresh failures', () => {
    const src = readFileSync(new URL('../api/cron/refresh-menu.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /alertStaff/);
    assert.match(src, /alertOps\(`MENU PRICE DRIFT/);
    assert.match(src, /alertOps\(`NIGHTLY MENU REFRESH FAILED/);
  });
});

describe('checkout that keeps failing before payment is reported', () => {
  it('the third distinct checkout refused by the register in an hour emails the owner once', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-12T16:00:00Z') });
    const { sms, email } = world((method, path) => {
      if (path.endsWith('/line_items')) return json({ message: 'Too Many Requests' }, 429, { 'retry-after': '30' });
      if (method === 'DELETE') return json({});
      return json({ id: 'DRAFT1' });
    });
    for (let i = 1; i <= 2; i++) {
      const r = await checkout();
      assert.equal(r.body.error, 'register_busy');
    }
    assert.deepEqual(email, [], 'two refusals in an hour can be bad luck');
    await checkout();
    await checkout();
    assert.equal(email.length, 1, 'one email, not one per refusal');
    assert.match(email[0].text, /CHECKOUT KEEPS FAILING BEFORE PAYMENT/);
    assert.equal(email[0].to, 'owner@example.test');
    assert.deepEqual(sms, [], 'the owner decides whether this should text the store');
  });

  it('a run of card declines emails the owner once', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-12T17:00:00Z') });
    const { sms, email } = world((method, path) => {
      if (path === '/v1/orders/DRAFT1') return json({ items: [{ amount: 1885 }] });
      if (path.endsWith('/pay')) return json({ error: { message: 'card declined' } }, 402);
      if (method === 'DELETE') return json({});
      return json({ id: 'DRAFT1' });
    });
    for (let i = 0; i < 8; i++) assert.equal((await checkout()).code, 402);
    assert.deepEqual(email, []);
    for (let i = 0; i < 3; i++) assert.equal((await checkout()).code, 402);
    assert.equal(email.length, 1);
    assert.match(email[0].text, /CARD DECLINE SPIKE/);
    assert.deepEqual(sms, []);
  });
});

describe('the morning digest notices a silent checkout outage', () => {
  it('flags checkout opens with no order, and stays quiet otherwise', async () => {
    const { checkoutOutageLine } = await import('../api/cron/daily-digest.js');
    assert.match(checkoutOutageLine(5, 0) ?? '', /5 visitors opened checkout yesterday, but no web order went through/);
    assert.equal(checkoutOutageLine(2, 0), null, 'a couple of abandoned carts is normal');
    assert.equal(checkoutOutageLine(9, 1), null, 'orders went through');
    assert.equal(checkoutOutageLine(null, 0), null, 'metrics unavailable is not an outage');
  });
});
