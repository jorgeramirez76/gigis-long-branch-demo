import assert from 'node:assert/strict';
import { afterEach, before, describe, it, type TestContext } from 'node:test';
import { setTimeout as realDelay } from 'node:timers/promises';
// Same harness as print-regressions (clover module) and refire-safety (the order handler).
process.env.DATABASE_URL = 'postgres://user:pass@fake-neon.test/dbname';
process.env.CLOVER_API_TOKEN = 'test-only';
process.env.CLOVER_MERCHANT_ID = 'test-merchant';
delete process.env.CLOVER_ECOMM_PRIVATE_TOKEN;
delete process.env.CLOVER_PRINT_DEVICE_IDS;
let originalFetch: typeof fetch;
let clover: typeof import('../api/lib/clover.js');
before(async () => { originalFetch = globalThis.fetch; clover = await import('../api/lib/clover.js'); });
afterEach(() => { globalThis.fetch = originalFetch; });

type Call = { method: string; path: string; body: Record<string, any> | undefined; at: number };
type Route = (call: Call) => Response | Promise<Response>;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const tooMany = (retryAfter?: string) =>
  json({ message: 'Too Many Requests' }, 429, {
    'x-ratelimit-tokenConcurrentLimit': '5',
    ...(retryAfter ? { 'retry-after': retryAfter } : {}),
  });

/** Every fetch is a recorded Clover call; `path` is relative to the merchant for v3 REST. */
function stubClover(route: Route): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const call: Call = {
      method: init?.method ?? 'GET',
      path: u.pathname.replace('/v3/merchants/test-merchant', '') + u.search,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      at: Date.now(),
    };
    calls.push(call);
    return route(call);
  }) as typeof fetch;
  return calls;
}
const isCreate = (c: Call) => c.method === 'POST' && c.path === '/orders';
const isLine = (c: Call) => c.method === 'POST' && c.path.endsWith('/line_items');
const isVerify = (c: Call) => c.method === 'GET' && c.path.includes('expand=lineItems');
const lineCalls = (calls: Call[]) => calls.filter(isLine);
const deletes = (calls: Call[]) => calls.filter((c) => c.method === 'DELETE');
const named = (calls: Call[], name: string) => lineCalls(calls).filter((c) => c.body?.name === name);
const paymentCalls = (calls: Call[]) => calls.filter((c) => /\/pay(?:$|\?)|\/charges(?:$|\?)/.test(c.path));

/** Brenaye's 10/10 cart: 6 Clover line items (Plain Pie + Sausage, the free Plain Pie, 3 Gourmet
 *  slices, Card pricing). Names after uniquifyLineNames: "Plain Pie", "Plain Pie #2", "Gourmet",
 *  "Gourmet #2", "Gourmet #3", "Card pricing (4%)". */
function brenayeCart(retry?: import('../api/lib/clover.js').CloverRetryBudget) {
  return {
    lines: [
      { itemName: 'Plain Pie', basePrice: 1700, quantity: 1, options: [{ group: 'Toppings', name: 'Sausage', delta: 300, placement: 'whole' as const }] },
      { itemName: 'Plain Pie', basePrice: 0, quantity: 1, options: [], notes: 'FREE — VIP welcome pie PIE-TEST01' },
      { itemName: 'Gourmet', basePrice: 375, quantity: 3, options: [] },
    ],
    fulfillment: 'pickup' as const,
    note: 'WEBSITE ORDER · CUSTOMER PICKUP · test',
    cardPricing: 125,
    ...(retry ? { retry } : {}),
  };
}

/** Drive mocked setTimeout/Date until the promise settles. */
async function pump<T>(t: TestContext, promise: Promise<T>): Promise<T> {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  while (!done) {
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(50);
  }
  return promise;
}
const status = (code: number) => (err: unknown) => err instanceof clover.CloverError && err.status === code;

describe('createDraftOrder under Clover rate limiting', () => {
  it('a 6-line cart never puts more than 3 line-item POSTs in flight', async () => {
    for (const [cart, expected] of [
      [brenayeCart(), 6],
      [{ ...brenayeCart(), lines: [{ itemName: 'Gourmet', basePrice: 375, quantity: 10, options: [] }], cardPricing: 150 }, 11],
    ] as const) {
      let inFlight = 0; let maxInFlight = 0;
      const calls = stubClover(async (c) => {
        if (isCreate(c)) return json({ id: 'ORDER1' });
        if (isLine(c)) {
          inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
          try {
            // Clover's per-token concurrent limit: a 6th request in flight is refused.
            if (inFlight > 5) return tooMany();
            await realDelay(5);
            return json({ id: 'LI' });
          } finally { inFlight--; }
        }
        return json({});
      });
      const draft = await clover.createDraftOrder(cart);
      assert.equal(draft.id, 'ORDER1');
      assert.ok(maxInFlight <= 3, `max in flight was ${maxInFlight}`);
      assert.equal(lineCalls(calls).length, expected);
      assert.equal(deletes(calls).length, 0);
      assert.equal(calls.filter(isVerify).length, 0, 'no retry happened, so no count check is needed');
    }
  });

  it('a 429 with retry-after: 1 on one line-item POST is retried once and the order succeeds', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.mock.method(Math, 'random', () => 0);
    let refused = false;
    const calls = stubClover((c) => {
      if (isCreate(c)) return json({ id: 'ORDER1' });
      if (isLine(c)) {
        if (c.body?.price === 0 && !refused) { refused = true; return tooMany('1'); }
        return json({ id: 'LI' });
      }
      if (isVerify(c)) return json({ lineItems: { elements: Array.from({ length: 6 }, (_, i) => ({ id: `LI${i}` })) } });
      return json({});
    });
    const draft = await pump(t, clover.createDraftOrder(brenayeCart()));
    assert.equal(draft.id, 'ORDER1');
    const free = named(calls, 'Plain Pie #2');
    assert.equal(free.length, 2, 'the refused free-pie line was sent again');
    assert.ok(free[1].at - free[0].at >= 1000, `retried after ${free[1].at - free[0].at}ms`);
    assert.equal(lineCalls(calls).length, 7);
    assert.equal(calls.filter((c) => c.method === 'GET' && c.path === '/orders/ORDER1?expand=lineItems').length, 1);
    assert.equal(deletes(calls).length, 0);
  });

  it('a 429 without retry-after backs off 1s then 2s and then gives up', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.mock.method(Math, 'random', () => 0);
    const calls = stubClover((c) => {
      if (isCreate(c)) return json({ id: 'ORDER1' });
      if (isLine(c)) return c.body?.price === 2000 ? tooMany() : json({ id: 'LI' });
      return json({});
    });
    await assert.rejects(pump(t, clover.createDraftOrder(brenayeCart())), status(429));
    const tries = named(calls, 'Plain Pie');
    assert.equal(tries.length, 3, 'one try and two retries');
    assert.ok(tries[1].at - tries[0].at >= 1000, `first gap ${tries[1].at - tries[0].at}ms`);
    assert.ok(tries[2].at - tries[1].at >= 2000, `second gap ${tries[2].at - tries[1].at}ms`);
    assert.equal(lineCalls(calls).length, 5, 'the second chunk never started');
    assert.deepEqual(deletes(calls).map((c) => c.path), ['/orders/ORDER1']);
  });

  it('a retry-after longer than 4s is not retried early', async () => {
    const calls = stubClover((c) => {
      if (isCreate(c)) return json({ id: 'ORDER1' });
      if (isLine(c)) return c.body?.price === 2000 ? tooMany('21') : json({ id: 'LI' });
      return json({});
    });
    const started = performance.now();
    await assert.rejects(clover.createDraftOrder(brenayeCart()), (err: unknown) => {
      assert.ok(err instanceof clover.CloverError);
      assert.equal(err.status, 429);
      assert.equal((err.body as Record<string, unknown>).__retryAfter, '21');
      assert.deepEqual((err.body as Record<string, unknown>).__rateLimit, ['x-ratelimit-tokenconcurrentlimit']);
      return true;
    });
    assert.ok(performance.now() - started < 900, 'failed fast instead of waiting out retry-after');
    assert.equal(named(calls, 'Plain Pie').length, 1);
    assert.deepEqual(deletes(calls).map((c) => c.path), ['/orders/ORDER1']);
  });

  it('a 500 or a network error on a line-item POST is never retried', async () => {
    for (const failure of ['500', 'network'] as const) {
      const calls = stubClover((c) => {
        if (isCreate(c)) return json({ id: 'ORDER1' });
        if (isLine(c) && c.body?.price === 2000) {
          if (failure === 'network') throw new TypeError('simulated lost Clover response');
          return json({ message: 'Internal Server Error' }, 500);
        }
        if (isLine(c)) return json({ id: 'LI' });
        return json({});
      });
      await assert.rejects(clover.createDraftOrder(brenayeCart()), failure === 'network' ? TypeError : status(500));
      assert.equal(named(calls, 'Plain Pie').length, 1, `${failure}: sent once`);
      assert.deepEqual(deletes(calls).map((c) => c.path), ['/orders/ORDER1'], `${failure}: rolled back`);
    }
    const calls = stubClover((c) => (isCreate(c) ? json({ message: 'Internal Server Error' }, 500) : json({})));
    await assert.rejects(clover.createDraftOrder(brenayeCart()), status(500));
    assert.equal(calls.length, 1, 'POST /orders 500 is not retried and there is no draft to delete');
  });

  it('a 429 on POST /orders is retried', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.mock.method(Math, 'random', () => 0);
    let created = 0; let refused = false;
    const calls = stubClover((c) => {
      if (isCreate(c)) {
        if (!refused) { refused = true; return tooMany('1'); }
        created++;
        return json({ id: 'ORDER1' });
      }
      if (isLine(c)) return json({ id: 'LI' });
      return json({});
    });
    const draft = await pump(t, clover.createDraftOrder(brenayeCart()));
    assert.equal(draft.id, 'ORDER1');
    assert.equal(calls.filter(isCreate).length, 2);
    assert.equal(created, 1, 'only one POST /orders succeeded');
    assert.equal(lineCalls(calls).length, 6);
    assert.equal(deletes(calls).length, 0);
  });

  it('a duplicated $0 free-pie line after a 429 retry fails closed', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.mock.method(Math, 'random', () => 0);
    const held: string[] = [];
    let refused = false;
    const calls = stubClover((c) => {
      if (isCreate(c)) return json({ id: 'ORDER1' });
      if (isLine(c)) {
        held.push(c.body?.name);
        // Clover applied the line AND answered 429: the retry makes a second free pie.
        if (c.body?.price === 0 && !refused) { refused = true; return tooMany('1'); }
        return json({ id: 'LI' });
      }
      if (isVerify(c)) return json({ lineItems: { elements: held.map((name) => ({ name })) } });
      return json({});
    });
    await assert.rejects(pump(t, clover.createDraftOrder(brenayeCart())), (err: unknown) => {
      assert.ok(err instanceof clover.CloverError);
      assert.equal(err.status, 409);
      assert.match(err.message, /draft holds 7 line items, expected 6/);
      return true;
    });
    assert.equal(held.filter((n) => n === 'Plain Pie #2').length, 2);
    assert.deepEqual(deletes(calls).map((c) => c.path), ['/orders/ORDER1']);
    assert.equal(paymentCalls(calls).length, 0);
  });

  it('rollback DELETE waits for in-flight siblings', async () => {
    const events: string[] = [];
    const calls = stubClover(async (c) => {
      if (isCreate(c)) return json({ id: 'ORDER1' });
      if (isLine(c)) {
        if (c.body?.price === 2000) { events.push('429'); return tooMany('30'); }
        await realDelay(20);
        events.push(`ok ${c.body?.name}`);
        return json({ id: 'LI' });
      }
      if (c.method === 'DELETE') { events.push('DELETE'); return json({}); }
      return json({});
    });
    await assert.rejects(clover.createDraftOrder(brenayeCart()), status(429));
    assert.deepEqual(events, ['429', 'ok Plain Pie #2', 'ok Gourmet', 'DELETE']);
    assert.equal(lineCalls(calls).length, 3);
  });

  it('a retry-after of 3 seconds is honoured, not shortened to the 1s floor', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.mock.method(Math, 'random', () => 0);
    let refused = false;
    const calls = stubClover((c) => {
      if (isCreate(c)) return json({ id: 'ORDER1' });
      if (isLine(c)) {
        if (c.body?.price === 0 && !refused) { refused = true; return tooMany('3'); }
        return json({ id: 'LI' });
      }
      if (isVerify(c)) return json({ lineItems: { elements: Array.from({ length: 6 }, (_, i) => ({ id: `LI${i}` })) } });
      return json({});
    });
    await pump(t, clover.createDraftOrder(brenayeCart()));
    const free = named(calls, 'Plain Pie #2');
    assert.equal(free.length, 2);
    assert.ok(free[1].at - free[0].at >= 3000, `retried after ${free[1].at - free[0].at}ms`);
  });

  it('a retry-after given as an HTTP date is honoured', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-10T20:21:12Z') });
    t.mock.method(Math, 'random', () => 0);
    let refused = false;
    const calls = stubClover((c) => {
      if (isCreate(c)) return json({ id: 'ORDER1' });
      if (isLine(c)) {
        if (c.body?.price === 0 && !refused) { refused = true; return tooMany(new Date(Date.now() + 2000).toUTCString()); }
        return json({ id: 'LI' });
      }
      if (isVerify(c)) return json({ lineItems: { elements: Array.from({ length: 6 }, (_, i) => ({ id: `LI${i}` })) } });
      return json({});
    });
    await pump(t, clover.createDraftOrder(brenayeCart()));
    const free = named(calls, 'Plain Pie #2');
    assert.equal(free.length, 2);
    const gap = free[1].at - free[0].at;
    assert.ok(gap >= 2000 && gap < 4000, `retried after ${gap}ms`);
  });

  it('siblings on one budget hold off until the longest Retry-After among them has passed', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.mock.method(Math, 'random', () => 0);
    let refusedA = false; let refusedB = false;
    const calls = stubClover((c) => {
      if (isCreate(c)) return json({ id: 'ORDER1' });
      if (isLine(c)) {
        if (c.body?.price === 2000 && !refusedA) { refusedA = true; return tooMany('1'); }
        if (c.body?.price === 0 && !refusedB) { refusedB = true; return tooMany('3'); }
        return json({ id: 'LI' });
      }
      if (isVerify(c)) return json({ lineItems: { elements: Array.from({ length: 6 }, (_, i) => ({ id: `LI${i}` })) } });
      return json({});
    });
    await pump(t, clover.createDraftOrder(brenayeCart()));
    const a = named(calls, 'Plain Pie'); const b = named(calls, 'Plain Pie #2');
    assert.equal(a.length, 2); assert.equal(b.length, 2);
    assert.ok(a[1].at - a[0].at >= 3000, `A retried after ${a[1].at - a[0].at}ms, inside B's 3s penalty`);
  });

  it("a 100-unit order stays under Clover's limits: never more than 12 line-item POSTs in any second", async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const calls = stubClover((c) => (isCreate(c) ? json({ id: 'ORDER1' }) : json({ id: 'LI' })));
    const cart = { ...brenayeCart(), lines: [{ itemName: 'Gourmet', basePrice: 375, quantity: 100, options: [] }], cardPricing: 1500 };
    const draft = await pump(t, clover.createDraftOrder(cart));
    assert.equal(draft.id, 'ORDER1');
    const posts = lineCalls(calls);
    assert.equal(posts.length, 101, '100 slices and the card-pricing line');
    for (const p of posts) {
      const inWindow = posts.filter((q) => q.at >= p.at && q.at < p.at + 1000).length;
      assert.ok(inWindow <= 12, `${inWindow} line-item POSTs within one second of ${p.body?.name}`);
    }
    assert.equal(deletes(calls).length, 0);
  });

  it('setup backoff never exceeds the shared budget', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.mock.method(Math, 'random', () => 0);
    const mockedSetTimeout = globalThis.setTimeout;
    let slept = 0;
    globalThis.setTimeout = ((fn: () => void, ms?: number, ...args: unknown[]) => {
      slept += ms ?? 0;
      return mockedSetTimeout(fn, ms, ...args);
    }) as typeof setTimeout;
    try {
      const calls = stubClover((c) => {
        if (isCreate(c)) return json({ id: 'ORDER1' });
        if (isLine(c)) return tooMany();
        return json({});
      });
      const budget = clover.cloverRetryBudget();
      await assert.rejects(pump(t, clover.createDraftOrder(brenayeCart(budget))), status(429));
      assert.ok(slept <= clover.SETUP_RETRY_BUDGET_MS, `slept ${slept}ms`);
      assert.ok(budget.remainingMs >= 0);
      assert.equal(slept, clover.SETUP_RETRY_BUDGET_MS - budget.remainingMs, 'every wait was charged to the budget');
      assert.deepEqual(deletes(calls).map((c) => c.path), ['/orders/ORDER1']);
    } finally {
      globalThis.setTimeout = mockedSetTimeout;
    }
  });
});

describe('getEcommOrderAmount under Clover rate limiting', () => {
  it('getEcommOrderAmount retries a 429 and still returns the exact amount', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.mock.method(Math, 'random', () => 0);
    let gets = 0;
    stubClover((c) => {
      if (c.path === '/v1/orders/ORDER1') return ++gets === 1 ? tooMany('1') : json({ items: [{ amount: 3300 }, { amount: 165 }] });
      return json({});
    });
    assert.equal(await pump(t, clover.getEcommOrderAmount('ORDER1', 3465)), 3465);
    assert.equal(gets, 2);

    gets = 0;
    stubClover((c) => (c.path === '/v1/orders/ORDER1' ? (gets++, tooMany('21')) : json({})));
    await assert.rejects(pump(t, clover.getEcommOrderAmount('ORDER1', 3465)), status(429));
    assert.equal(gets, 1, 'a long retry-after is not retried early');

    gets = 0;
    stubClover((c) => (c.path === '/v1/orders/ORDER1' ? (gets++, json({ message: 'Forbidden' }, 403)) : json({})));
    await assert.rejects(pump(t, clover.getEcommOrderAmount('ORDER1', 3465)), status(403));
    assert.equal(gets, 1, 'other 4xx are unchanged');
  });
});

describe('calls without a budget are unchanged', () => {
  it('calls without a budget are unchanged', async () => {
    let calls = stubClover((c) => (c.path === '/print_event' ? tooMany('1') : json({})));
    const printed = await clover.printOrderTicket('ORDER1');
    assert.equal(printed.printed, false);
    assert.equal(calls.filter((c) => c.path === '/print_event').length, 1, 'no second kitchen ticket');

    calls = stubClover(() => tooMany('1'));
    await assert.rejects(clover.fireOrder('ORDER1', { paid: true }), status(429));
    assert.equal(calls.length, 1);
  });
});

// ---- the checkout handler (pattern: tests/refire-safety.test.ts 'itemized total payment gate') ----
function result(data: Record<string, unknown>[] = [], count = data.length) {
  const keys = Object.keys(data[0] ?? {});
  return new Response(JSON.stringify({ command: 'SELECT', rowCount: count,
    fields: keys.map(name => ({ name, dataTypeID: typeof data[0][name] === 'number' ? 23 : 25 })),
    rows: data.map(row => keys.map(key => row[key] == null ? null : String(row[key]))) }), { status: 200 });
}

describe('checkout when Clover keeps throttling', () => {
  it('a persistent Clover 429 tells the customer the register is busy and charges nothing', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-12T16:00:00Z') });
    process.env.ORDER_PROVIDER = 'inhouse';
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.CARD_PAYMENTS_OFF;
    delete process.env.VITE_CARD_PAYMENTS_OFF;
    const calls: string[] = [];
    const queries: string[] = [];
    globalThis.fetch = (async (url, init) => {
      const u = String(url); const method = init?.method ?? 'GET';
      if (u.includes('clover.com')) {
        calls.push(method + ' ' + u);
        assert.ok(!/\/pay(?:$|\?)|\/charges(?:$|\?)/.test(u), 'a throttled setup must never reach a payment endpoint');
        if (u.endsWith('/line_items')) return tooMany('30');
        if (method === 'DELETE') return json({});
        return json({ id: 'DRAFT1' });
      }
      const q = JSON.parse(String(init?.body)) as { query: string };
      queries.push(q.query);
      if (q.query.includes('INSERT INTO web_orders')) return result([{ id: 11 }]);
      if (q.query.includes('INSERT INTO rate_counters')) return result([{ n: 1 }]);
      if (/^\s*(CREATE|ALTER|UPDATE|DELETE)/.test(q.query)) return result([], 1);
      if (/^\s*(SELECT|WITH)/.test(q.query)) return result();
      throw new Error('Unexpected mocked query ' + q.query);
    }) as typeof fetch;
    const create = (await import('../api/order/create.js')).default;
    let code = 0; let body: Record<string, unknown> = {};
    const res = { setHeader() {}, status(value: number) { code = value; return this; }, json(value: Record<string, unknown>) { body = value; return this; } };
    await create({ method: 'POST', headers: {}, body: {
      idempotencyKey: '11111111-2222-4333-8444-666666666666', fulfillment: 'pickup',
      customer: { name: 'Test customer', phone: '7325550100', email: 'test@example.com' },
      lines: [{ itemName: 'Plain Pie', categoryId: 'pizza', quantity: 1, selections: [] }],
      cardToken: 'clv_test', paymentMethod: 'card', expectedTotal: 1885,
    } } as never, res as never);
    assert.equal(code, 502, JSON.stringify(body));
    assert.equal(body.error, 'register_busy');
    assert.match(String(body.message), /busy/);
    assert.match(String(body.message), /try again in a minute/);
    assert.match(String(body.message), /card was not charged/);
    assert.ok(calls.some((c) => c.startsWith('DELETE ') && c.endsWith('/orders/DRAFT1')), 'the partial draft is discarded');
    assert.ok(queries.some((q) => /DELETE FROM web_orders/.test(q)), 'the reservation is released so the customer can retry');
    assert.ok(!calls.some((c) => /\/pay(?:$|\?)|\/charges(?:$|\?)/.test(c)));
  });
});
