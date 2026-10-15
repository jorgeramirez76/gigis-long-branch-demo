import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
process.env.DATABASE_URL = 'postgres://user:pass@fake-neon.test/dbname';
process.env.ADMIN_TOKEN = 'admin-test-token';
delete process.env.CLOVER_API_TOKEN;
delete process.env.CLOVER_MERCHANT_ID;
const { default: handler } = await import('../api/admin/clover-status.ts');
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

/** rate_counters holding `counts` per (bucket@window_start); any other query returns no rows. */
function counters(counts: Record<string, number> | 'down') {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.ok(String(url).includes('neon') || String(url).includes('api.test'), `unexpected provider call ${String(url)}`);
    if (counts === 'down') throw new TypeError('fetch failed');
    const { query, params } = JSON.parse(String(init?.body)) as { query: string; params: unknown[] };
    const n = query.includes('SELECT n FROM rate_counters') ? counts[`${String(params[0])}@${String(params[1])}`] : undefined;
    return new Response(JSON.stringify({ command: 'SELECT', rowCount: n == null ? 0 : 1,
      fields: n == null ? [] : [{ name: 'n', dataTypeID: 23 }], rows: n == null ? [] : [[String(n)]] }));
  }) as typeof fetch;
}
async function status() {
  let code = 0; let body: Record<string, unknown> = {};
  const res = { setHeader() { return this; }, status(v: number) { code = v; return this; }, json(v: Record<string, unknown>) { body = v; return this; } };
  await handler({ method: 'GET', headers: { 'x-admin-token': 'admin-test-token' }, query: {} } as never, res as never);
  return { code, config: body.config as Record<string, unknown> };
}

it('the Clover status check shows the site-wide card declines in the last two 15-minute windows', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-14T21:07:00Z') });
  // 21:00 UTC window = 1792011600; the one before began 900 s earlier.
  counters({ 'card-declines:all@1792011600': 5, 'card-declines:all@1792010700': 11 });
  const { code, config } = await status();
  assert.equal(code, 200);
  assert.deepEqual(config.cardDeclines, {
    windowMinutes: 15, alertAbove: 8, windowStartedAt: '2026-10-14T21:00:00.000Z', current: 5, previous: 11,
  });
});

it('a quiet counter reads 0, and an unreadable one reads null without failing the check', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-14T21:07:00Z') });
  counters({});
  let { code, config } = await status();
  assert.equal(code, 200);
  assert.equal((config.cardDeclines as { current: number }).current, 0);
  counters('down');
  ({ code, config } = await status());
  assert.equal(code, 200);
  assert.equal((config.cardDeclines as { current: null }).current, null);
});
