import assert from 'node:assert/strict';
import { afterEach, describe, it, type TestContext } from 'node:test';
// A real online order with a PERCENT-OFF-PIZZA campaign code, end to end through /api/order/create.
//
// THANKYOU (VIP Appreciation Week, Oct 16-22 2026) is the first pct_pizza campaign real customers
// will use — until now only the GAMEDAY bogo path has been exercised by a live order. The handler
// is driven exactly as tests/order-tail.test.ts drives it: Neon over HTTP and Clover REST/ecommerce
// both go through global fetch, answered here by query substring and by URL. Nothing real is
// reached, and the clock is pinned inside (and outside) the campaign window.
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
delete process.env.ACCOUNTS_ENABLED;
delete process.env.RESEND_API_KEY;
delete process.env.STAFF_ALERT_EMAIL;
delete process.env.OPS_ALERT_EMAIL;
delete process.env.DIGEST_EMAIL;

import { TAX_RATE } from '../api/lib/clover.js';
import { CARD_PRICING_LABEL, cardPricingCents } from '../api/lib/cardPricing.mjs';
import { resolvePromo } from '../api/lib/campaignPromo.js';
import { planPizzaPercent } from '../src/lib/pizzaPercent.js';
import { capLineOptions, findCatalogItem, optionDelta } from '../src/lib/menuPricing.js';
import { deliveryFeeCents } from '../src/lib/deliveryZones.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

// ---- the campaign row, exactly as production holds it ----
const PERCENT = 20;
const THANKYOU = {
  id: 42, code: 'THANKYOU', kind: 'pct_pizza', description: 'VIP Appreciation Week — 20% off any pizza',
  pickup_only: false, active: true,
  starts_at: new Date('2026-10-16T04:00:00Z'), expires_at: new Date('2026-10-23T04:00:00Z'), percent_off: PERCENT,
};
/** Saturday Oct 17, noon EDT — inside the window, the shop open. */
const IN_WINDOW = new Date('2026-10-17T16:00:00Z');

// ---- the cart: one topped pizza + one non-pizza item, both real catalog items ----
// Fair Haven Pie $26.99 + Pepperoni $3.00 = $29.99, so 20% is 599.8¢: the per-unit rounding
// planPizzaPercent does (to 600¢) is actually exercised, not just a clean multiple of 5.
const PIZZA = { itemName: 'Fair Haven Pie', categoryId: 'pizza' };
const KNOTS = { itemName: 'Garlic Knots', categoryId: 'appetizers' };
const PEPPERONI = { group: 'Toppings', name: 'Pepperoni', placement: 'whole' as const };

const pie = findCatalogItem(PIZZA.itemName, PIZZA.categoryId);
const knots = findCatalogItem(KNOTS.itemName, KNOTS.categoryId);
assert.ok(pie && knots, 'both fixture items are in the catalog');
const pepperoniDelta = optionDelta(pie, PEPPERONI);
assert.equal(pepperoniDelta, 300, 'Pepperoni on this pie is a charged $3.00 topping');
/** One topped pizza unit, and what 20% of it comes to — the figure every assertion below expects. */
const PIZZA_UNIT = pie.basePrice + pepperoniDelta;
const PIZZA_OFF = Math.round((PIZZA_UNIT * PERCENT) / 100);
assert.notEqual((PIZZA_UNIT * PERCENT) % 100, 0, 'the fixture pie makes 20% a fractional cent, so rounding is under test');

// ---- the browser's side of the maths (src/ordering/CartContext.tsx + src/ordering/Checkout.tsx) ----
type Placement = 'whole' | 'left' | 'right';
type ClientCartLine = {
  itemName: string; categoryId: string; basePrice: number;
  options: { group: string; name: string; delta: number; placement?: Placement }[]; quantity: number;
};
/** A cart line as CartContext holds it: catalog base price, each option priced by the shared menuPricing. */
function clientLine(item: { itemName: string; categoryId: string }, quantity: number, picks: { group: string; name: string; placement?: Placement }[] = []): ClientCartLine {
  const entry = findCatalogItem(item.itemName, item.categoryId);
  assert.ok(entry, `${item.itemName} is in the catalog`);
  const options = capLineOptions(entry, picks.map((o) => {
    const delta = optionDelta(entry, o);
    assert.ok(delta != null, `${o.name} is an option on ${item.itemName}`);
    return { ...o, delta };
  }));
  return { ...item, basePrice: entry.basePrice, options, quantity };
}
/** The figures Checkout.tsx shows and sends — its promo block, card pricing, tax, tip and grandTotal, line for line. */
function checkoutTotals(lines: ClientCartLine[], fulfillment: 'pickup' | 'delivery', percentOff: number, town?: string) {
  // CartContext.tsx: subtotal = Σ lineUnitPrice × quantity (TAX_RATE there is the same 6.625%).
  const subtotal = lines.reduce((s, l) => s + (l.basePrice + l.options.reduce((a, o) => a + o.delta, 0)) * l.quantity, 0);
  const deliveryFee = fulfillment === 'delivery' ? (deliveryFeeCents('delivery', town) ?? 0) : 0;
  const pct = planPizzaPercent(lines, percentOff);
  const promoDiscount = pct.discountCents > 0 ? Math.min(pct.discountCents, subtotal) : 0;
  const cardPricing = cardPricingCents(subtotal - promoDiscount);
  const tax = Math.round((subtotal - promoDiscount + cardPricing + deliveryFee) * TAX_RATE);
  const tipPct = fulfillment === 'delivery' ? 20 : 0; // the checkout's default tip until the customer taps one
  const tip = Math.round((subtotal - promoDiscount) * (tipPct / 100));
  return { subtotal, promoDiscount, cardPricing, deliveryFee, tax, tip, grandTotal: subtotal - promoDiscount + cardPricing + deliveryFee + tax + tip };
}
/** The request body Checkout.tsx posts: identifiers and quantities only, never prices. */
function order(key: string, lines: ClientCartLine[], o: { fulfillment?: 'pickup' | 'delivery'; promoCode?: string; town?: string } = {}) {
  const fulfillment = o.fulfillment ?? 'pickup';
  const totals = checkoutTotals(lines, fulfillment, o.promoCode ? PERCENT : 0, o.town);
  const req = {
    method: 'POST', headers: {}, body: {
      idempotencyKey: key, fulfillment,
      customer: {
        name: 'Test customer', phone: '7325550100', email: 'test@example.com',
        ...(fulfillment === 'delivery' ? { address: '12 Brighton Ave', town: o.town } : {}),
      },
      lines: lines.map((l) => ({
        itemName: l.itemName, categoryId: l.categoryId, quantity: l.quantity,
        options: l.options.map((x) => ({ group: x.group, name: x.name, placement: x.placement })),
      })),
      tipCents: totals.tip, expectedTotal: totals.grandTotal,
      promoCode: o.promoCode, cardToken: 'clv_test', paymentMethod: 'card',
    },
  };
  return { req, totals };
}
const cartWithPizza = () => [clientLine(PIZZA, 1, [PEPPERONI]), clientLine(KNOTS, 1)];

// ---- Neon-over-HTTP and Clover, answered by substring / URL ----
/** A Neon HTTP result. Booleans and timestamps travel as the driver expects them (bool 't'/'f',
 *  timestamptz in Postgres text form), so pickup_only=false arrives as a real `false`. */
function rows(data: Record<string, unknown>[] = [], count = data.length) {
  const keys = Object.keys(data[0] ?? {});
  const typeOf = (v: unknown) => (typeof v === 'number' ? 23 : typeof v === 'boolean' ? 16 : v instanceof Date ? 1184 : 25);
  const text = (v: unknown) =>
    v == null ? null : typeof v === 'boolean' ? (v ? 't' : 'f') : v instanceof Date ? v.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '+00') : String(v);
  return new Response(JSON.stringify({ command: 'SELECT', rowCount: count,
    fields: keys.map((name) => ({ name, dataTypeID: typeOf(data[0][name]) })),
    rows: data.map((row) => keys.map((key) => text(row[key]))) }), { status: 200 });
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Query = { q: string; p: unknown[] };
type Backend = {
  clover: string[];
  lineItems: { name: string; price: number; note?: string }[];
  fires: Record<string, unknown>[];
  pays: Record<string, unknown>[];
  queries: Query[];
  sms: string[];
  redemptions: unknown[][];
  /** The one web_orders row this key can hold, as the handler's writes leave it. */
  ledger: { insert: Query; status: string; chargeId: string | null; cloverOrderId: string | null } | null;
  /** Hide the ledger row from the next N idempotency-key lookups (a replay that races past the peek). */
  hideLedgerFor: number;
};
function backend(): Backend {
  const b: Backend = { clover: [], lineItems: [], fires: [], pays: [], queries: [], sms: [], redemptions: [], ledger: null, hideLedgerFor: 0 };
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url); const method = init?.method ?? 'GET';
    if (u.includes('api.twilio.com')) { b.sms.push(String(new URLSearchParams(String(init?.body)).get('Body'))); return json({ sid: 'SM1' }, 201); }
    if (u.includes('clover.com')) {
      const path = new URL(u).pathname.replace('/v3/merchants/test-merchant', '');
      b.clover.push(`${method} ${path}`);
      assert.ok(init?.signal instanceof AbortSignal, `${method} ${path} has no timeout`);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (path === '/orders' && method === 'POST') return json({ id: 'DRAFT1' });
      if (path === '/orders/DRAFT1/line_items' && method === 'POST') {
        b.lineItems.push({ name: String(body.name), price: Number(body.price), note: typeof body.note === 'string' ? body.note : undefined });
        return json({ id: `LI${b.lineItems.length}` });
      }
      if (path === '/v1/orders/DRAFT1' && method === 'GET') {
        // Clover's ecommerce mirror of the draft: every line item at the price we posted, plus the
        // NJ tax Clover computes on them. The handler charges only if this equals its own total.
        const food = b.lineItems.reduce((s, li) => s + li.price, 0);
        return json({ items: [...b.lineItems.map((li) => ({ name: li.name, amount: li.price })), { type: 'tax', amount: Math.round(food * TAX_RATE) }] });
      }
      if (path === '/v1/orders/DRAFT1/pay' && method === 'POST') { b.pays.push(body); return json({ id: 'CHG1', status: 'paid', paid: true, captured: true }); }
      if (path === '/orders/DRAFT1' && method === 'GET') return json({ id: 'DRAFT1', payments: { elements: [{ id: 'PAY1' }] } });
      if (path === '/orders/DRAFT1' && method === 'POST') { b.fires.push(body); return json({ id: 'DRAFT1' }); }
      if (path === '/orders/DRAFT1' && method === 'DELETE') return json({});
      if (path === '/print_event' && method === 'POST') return json({ id: 'EV1', state: 'CREATED' });
      if (path === '/print_event/EV1') return json({ state: 'PRINTED' });
      throw new Error(`unexpected Clover call ${method} ${path}`);
    }
    const { query: q, params: p } = JSON.parse(String(init?.body)) as { query: string; params: unknown[] };
    b.queries.push({ q, p });
    if (q.includes('FROM campaign_promos')) return p[1] === THANKYOU.code ? rows([THANKYOU]) : rows();
    if (q.includes('FROM vip_promo_codes')) return rows();
    if (q.includes('INSERT INTO web_orders')) {
      if (b.ledger) return rows(); // ON CONFLICT (idempotency_key) DO NOTHING: no RETURNING row
      b.ledger = { insert: { q, p }, status: 'pending', chargeId: null, cloverOrderId: null };
      return rows([{ id: 11 }]);
    }
    if (q.includes('FROM web_orders WHERE idempotency_key')) {
      if (!b.ledger) return rows();
      if (b.hideLedgerFor > 0) { b.hideLedgerFor--; return rows(); }
      return rows([{ id: 11, status: b.ledger.status, charge_id: b.ledger.chargeId, clover_order_id: b.ledger.cloverOrderId, age: 30 }]);
    }
    if (q.includes('UPDATE web_orders SET')) {
      assert.ok(b.ledger, 'an update needs a reserved row');
      if (q.includes("status = 'paid_print_queued'")) { // settleQueuedPrint: conditional on still being queued
        if (b.ledger.status !== 'paid_print_queued') return rows([], 0);
        b.ledger.status = String(p[0]);
        return rows([{ id: 11 }], 1);
      }
      if (p[0] != null) b.ledger.status = String(p[0]);
      if (p[1] != null) b.ledger.chargeId = String(p[1]);
      if (p[2] != null) b.ledger.cloverOrderId = String(p[2]);
      return rows([{ id: 11 }], 1);
    }
    if (q.includes('DELETE FROM web_orders')) { b.ledger = null; return rows([], 1); }
    if (q.includes('INSERT INTO campaign_redemptions')) { b.redemptions.push(p); return rows([], 1); }
    if (q.includes('RETURNING n')) return rows([{ n: 1 }]);
    if (/^\s*(UPDATE|DELETE|CREATE|ALTER|INSERT)/.test(q)) return rows([{ id: 11 }], 1);
    return rows();
  }) as typeof fetch;
  return b;
}
/** One column of the web_orders INSERT, by name — the VALUES list has a literal ('pending') in it,
 *  so a column's position is not its parameter number. */
function insertedColumn(ins: Query, column: string): unknown {
  const cols = /INSERT INTO web_orders\s*\(([^)]*)\)/.exec(ins.q)?.[1].split(',').map((c) => c.trim()) ?? [];
  const vals = /VALUES\s*\(([\s\S]*?)\)\s*ON CONFLICT/.exec(ins.q)?.[1].split(',').map((v) => v.trim()) ?? [];
  const i = cols.indexOf(column);
  assert.ok(i >= 0 && vals[i] !== undefined, `web_orders row carries ${column}`);
  const m = /^\$(\d+)$/.exec(vals[i]);
  return m ? ins.p[Number(m[1]) - 1] : vals[i];
}

/** Drive mocked setTimeout until the promise settles (print poll, ecomm read, line-item pacing). */
async function pump<T>(t: TestContext, promise: Promise<T>): Promise<T> {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  while (!done) {
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(50);
  }
  return promise;
}
type Answer = { code: number; body: Record<string, unknown> };
async function run(t: TestContext, req: unknown): Promise<Answer> {
  const state: Answer = { code: 0, body: {} };
  const res = { setHeader() { return this; }, status(v: number) { state.code = v; return this; }, json(v: Record<string, unknown>) { state.body = v; return this; } };
  const create = (await import('../api/order/create.js')).default;
  await pump(t, create(req as never, res as never));
  return state;
}
const pinClock = (t: TestContext, now: Date) => t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
const welcomeLookups = (b: Backend) => b.queries.filter((x) => x.q.includes('FROM vip_promo_codes')).length;

/** Everything a correctly applied THANKYOU order must look like, on the wire and in the ledger. */
function assertApplied(answer: Answer, b: Backend, key: string, totals: ReturnType<typeof checkoutTotals>, fulfillment: 'pickup' | 'delivery') {
  assert.equal(answer.code, 200, JSON.stringify(answer.body));
  assert.equal(answer.body.ok, true);
  assert.equal(answer.body.paid, true);
  assert.equal(answer.body.orderId, 'DRAFT1');
  assert.equal(answer.body.chargeId, 'PAY1');
  assert.equal(answer.body.routingIssue, undefined, 'a printed ticket is the plain accepted outcome');
  assert.equal(answer.body.free, undefined, 'a percent-off order is paid, never a free-pie order');
  assert.deepEqual(b.sms, [], 'nobody is paged');

  // The discount: 20% of base price + toppings, per unit, to the cent — and nothing off the knots.
  const got = answer.body.totals as Record<string, number>;
  assert.equal(got.discount, PIZZA_OFF);
  assert.equal(got.discount, planPizzaPercent(cartWithPizza(), PERCENT).discountCents, 'the server used the shared planPizzaPercent maths');
  // The handler's totals equal what the checkout showed, so clientTotalMatches() let it through.
  assert.deepEqual(
    { subtotal: got.subtotal, discount: got.discount, cardPricing: got.cardPricing, deliveryFee: got.deliveryFee, tax: got.tax, tip: got.tip, total: got.total },
    { subtotal: totals.subtotal, discount: totals.promoDiscount, cardPricing: totals.cardPricing, deliveryFee: totals.deliveryFee, tax: totals.tax, tip: totals.tip, total: totals.grandTotal },
  );

  // Clover: one draft, line items at the LOWERED prices, verified, paid, fired, printed — in that order.
  const at = (call: string) => { const i = b.clover.indexOf(call); assert.ok(i >= 0, `${call} happened: ${b.clover.join(' | ')}`); return i; };
  assert.equal(b.clover[0], 'POST /orders');
  assert.ok(at('GET /v1/orders/DRAFT1') < at('POST /v1/orders/DRAFT1/pay'), 'the amount was checked before the card was charged');
  assert.ok(at('POST /v1/orders/DRAFT1/pay') < at('POST /orders/DRAFT1'), 'fired only after payment');
  assert.ok(at('POST /orders/DRAFT1') < at('POST /print_event'));
  assert.equal(b.pays.length, 1, 'exactly one charge');
  assert.equal(b.pays[0].tip_amount, totals.tip || undefined);
  assert.ok(b.clover.every((c) => !c.startsWith('DELETE ')), 'no draft was discarded');

  const pizza = b.lineItems.filter((li) => li.name === PIZZA.itemName);
  const knotsLine = b.lineItems.filter((li) => li.name === KNOTS.itemName);
  assert.equal(pizza.length, 1);
  assert.equal(knotsLine.length, 1);
  assert.equal(pizza[0].price, PIZZA_UNIT - PIZZA_OFF, 'the pizza line carries the lowered price');
  assert.match(pizza[0].note ?? '', /20% OFF — THANKYOU/);
  assert.match(pizza[0].note ?? '', /TOPPINGS FULL PIE: Pepperoni/, 'the topping is still on the ticket');
  assert.equal(knotsLine[0].price, knots!.basePrice, 'the non-pizza line is untouched');
  assert.doesNotMatch(knotsLine[0].note ?? '', /OFF/);
  assert.ok(b.lineItems.every((li) => li.price >= 0), `no negative price: ${JSON.stringify(b.lineItems)}`);
  assert.equal(b.lineItems.find((li) => li.name === CARD_PRICING_LABEL)?.price, totals.cardPricing);
  assert.equal(b.lineItems.find((li) => li.name === 'Delivery Fee')?.price, fulfillment === 'delivery' ? totals.deliveryFee : undefined);
  assert.equal(
    b.lineItems.reduce((s, li) => s + li.price, 0),
    totals.subtotal - totals.promoDiscount + totals.cardPricing + totals.deliveryFee,
    "Clover's line items add up to the food paid for, so its total agrees with ours",
  );
  assert.equal(b.fires.length, 1);
  assert.equal(b.fires[0].state, 'open');
  assert.equal(b.fires[0].paymentState, 'PAID');
  assert.match(String(b.fires[0].title), /\*\* VIP PROMO \*\*/);
  assert.match(String(b.fires[0].note), /★ VIP PROMO ★/);
  assert.match(String(b.fires[0].note), new RegExp(`Promo -\\$${(PIZZA_OFF / 100).toFixed(2).replace('.', '\\.')}`));

  // The ledger row records the code and the discount, and ended up paid.
  assert.ok(b.ledger, 'a web_orders row was reserved');
  assert.equal(insertedColumn(b.ledger.insert, 'promo_code'), 'THANKYOU');
  assert.equal(Number(insertedColumn(b.ledger.insert, 'discount_cents')), PIZZA_OFF);
  assert.equal(Number(insertedColumn(b.ledger.insert, 'total')), totals.grandTotal);
  assert.equal(Number(insertedColumn(b.ledger.insert, 'fee_cents')), totals.deliveryFee);
  const items = JSON.parse(String(insertedColumn(b.ledger.insert, 'items'))) as { itemName: string; basePrice: number; notes?: string }[];
  assert.equal(items.find((l) => l.itemName === PIZZA.itemName)?.basePrice, pie!.basePrice - PIZZA_OFF, 'the stored kitchen line is the discounted one');
  assert.match(items.find((l) => l.itemName === PIZZA.itemName)?.notes ?? '', /20% OFF — THANKYOU/);
  assert.equal(b.ledger.status, 'paid');
  assert.equal(b.ledger.chargeId, 'PAY1');
  assert.equal(b.ledger.cloverOrderId, 'DRAFT1');

  // Counted once, against this key, never burned; the welcome-pie table was never consulted.
  assert.equal(b.redemptions.length, 1, 'recordCampaignRedemption ran exactly once');
  assert.deepEqual(b.redemptions[0].map(String), [String(THANKYOU.id), key, 'DRAFT1', '7325550100', String(PIZZA_OFF), '0']);
  assert.match(b.queries.find((x) => x.q.includes('INSERT INTO campaign_redemptions'))!.q, /ON CONFLICT \(campaign_id, idempotency_key\) DO NOTHING/);
  assert.equal(welcomeLookups(b), 0);
  assert.ok(!b.queries.some((x) => /UPDATE vip_promo_codes/.test(x.q)), 'no welcome code was reserved or redeemed');
}

describe('a pickup order with the THANKYOU percent-off code', () => {
  for (const [typed, key] of [['THANKYOU', '11111111-2222-4333-8444-aaaaaaaaaa01'], [' thankyou ', '11111111-2222-4333-8444-aaaaaaaaaa02']] as const) {
    it(`"${typed}": 20% off the topped pizza only, charged, fired, printed, recorded once`, async (t) => {
      pinClock(t, IN_WINDOW);
      const b = backend();
      const { req, totals } = order(key, cartWithPizza(), { promoCode: typed });
      assert.equal(totals.promoDiscount, PIZZA_OFF, 'the checkout preview agrees on the discount');
      const answer = await run(t, req);
      assertApplied(answer, b, key, totals, 'pickup');
    });
  }
});

describe('a delivery order with the THANKYOU code (its row allows delivery)', () => {
  it('fee, 4% card pricing and the default 20% tip all in play: accepted at the total the checkout showed', async (t) => {
    pinClock(t, IN_WINDOW);
    const b = backend();
    const key = '11111111-2222-4333-8444-aaaaaaaaaa03';
    const { req, totals } = order(key, cartWithPizza(), { promoCode: 'THANKYOU', fulfillment: 'delivery', town: 'Long Branch' });
    assert.equal(totals.deliveryFee, 300);
    assert.ok(totals.tip > 0 && totals.cardPricing > 0, 'the fixture really has a tip and card pricing');
    // Card pricing and the tip follow the DISCOUNTED food, as both sides compute them.
    assert.equal(totals.cardPricing, cardPricingCents(totals.subtotal - PIZZA_OFF));
    assert.equal(totals.tip, Math.round((totals.subtotal - PIZZA_OFF) * 0.2));
    const answer = await run(t, req);
    assert.notEqual(answer.body.error, 'promo_pickup_only', 'THANKYOU is not pickup-only');
    assert.notEqual(answer.body.error, 'total_changed', 'the server and the checkout computed the same total');
    assertApplied(answer, b, key, totals, 'delivery');
    assert.equal(insertedColumn(b.ledger!.insert, 'town'), 'Long Branch');
    assert.equal(insertedColumn(b.ledger!.insert, 'fulfillment'), 'delivery');
    assert.match(String(b.fires[0].note), /FOR DELIVERY/);
    assert.match(String(b.fires[0].note), /Dlv \$3\.00/);
    assert.match(String(b.fires[0].title), /FOR DELIVERY/);
  });
});

describe('the code on a cart with no pizza', () => {
  it('is refused with a clear message before anything is reserved, drafted or charged — never a 500', async (t) => {
    pinClock(t, IN_WINDOW);
    const b = backend();
    const { req } = order('11111111-2222-4333-8444-aaaaaaaaaa04', [clientLine(KNOTS, 2)], { promoCode: 'THANKYOU' });
    const answer = await run(t, req);
    assert.equal(answer.code, 400, JSON.stringify(answer.body));
    assert.equal(answer.body.error, 'promo_needs_pizza');
    assert.equal(answer.body.message, '20% off any pizza — add a pizza from the Pizza menu to use this code.');
    assert.deepEqual(b.clover, [], 'Clover never heard about it');
    assert.equal(b.ledger, null, 'no web_orders row');
    assert.deepEqual(b.redemptions, []);
    assert.deepEqual(b.sms, []);
  });
});

describe('outside the campaign window', () => {
  const key = '11111111-2222-4333-8444-aaaaaaaaaa05';
  function assertRefused(answer: Answer, b: Backend, message: string) {
    assert.equal(answer.code, 400, JSON.stringify(answer.body));
    assert.equal(answer.body.error, 'promo_invalid');
    assert.equal(answer.body.message, message);
    assert.notEqual(answer.body.message, "We don't recognise that code.", 'the window verdict is given, not a welcome-code miss');
    assert.equal(welcomeLookups(b), 0, 'THANKYOU was never looked up as a PIE- welcome code');
    assert.equal(answer.body.free, undefined);
    assert.deepEqual(b.clover, [], 'nothing drafted, nothing charged');
    assert.equal(b.ledger, null);
    assert.deepEqual(b.redemptions, []);
  }

  it("tonight (Thu Oct 15, 6:30 PM EDT): \"hasn't started yet\", not charged, not a welcome code", async (t) => {
    pinClock(t, new Date('2026-10-15T22:30:00Z'));
    const b = backend();
    const { req } = order(key, cartWithPizza(), { promoCode: 'THANKYOU' });
    assertRefused(await run(t, req), b, "That offer hasn't started yet.");
  });

  it('Fri Oct 23, 1:00 AM EDT: online ordering is closed, so the store-hours gate answers first; the resolver itself says "ended"', async (t) => {
    pinClock(t, new Date('2026-10-23T05:00:00Z'));
    const b = backend();
    const { req } = order(key, cartWithPizza(), { promoCode: 'THANKYOU' });
    const answer = await run(t, req);
    // 05:00Z is 1 AM in Long Branch — web orders stop at 11 PM, so the handler refuses the order
    // before it ever reads the code. Nothing is charged either way.
    assert.equal(answer.code, 409, JSON.stringify(answer.body));
    assert.equal(answer.body.error, 'store_closed');
    assert.deepEqual(b.clover, []);
    assert.equal(b.ledger, null);
    // The same instant, through the exact resolver the handler calls once the shop is open:
    const verdict = await resolvePromo('gigis_long_branch', 'THANKYOU');
    assert.deepEqual(verdict, { ok: false, message: 'That offer has ended.' });
    assert.equal(welcomeLookups(b), 0, 'an expired campaign code is not retried as a welcome code');
  });

  it('Fri Oct 23, 10:00 AM EDT (first open minute after expiry): "has ended", not charged, not a welcome code', async (t) => {
    pinClock(t, new Date('2026-10-23T14:00:00Z'));
    const b = backend();
    const { req } = order(key, cartWithPizza(), { promoCode: 'THANKYOU' });
    assertRefused(await run(t, req), b, 'That offer has ended.');
  });
});

describe('a replay of the pickup order with the same idempotency key', () => {
  it('answers the placed order again and records the redemption only once', async (t) => {
    pinClock(t, IN_WINDOW);
    const b = backend();
    const key = '11111111-2222-4333-8444-aaaaaaaaaa06';
    const { req, totals } = order(key, cartWithPizza(), { promoCode: 'THANKYOU' });
    assertApplied(await run(t, req), b, key, totals, 'pickup');
    const cloverCalls = b.clover.length;

    // The customer taps again (lost response, double tap): the ledger row answers.
    const replay = await run(t, req);
    assert.equal(replay.code, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.duplicate, true);
    assert.equal(replay.body.paid, true);
    assert.equal(replay.body.orderId, 'DRAFT1');
    assert.equal(b.clover.length, cloverCalls, 'no second draft, charge or ticket');
    assert.equal(b.pays.length, 1);
    assert.equal(b.redemptions.length, 1, 'still counted once');

    // A replay that races past the read-only peek and reaches the atomic reservation instead.
    b.hideLedgerFor = 2;
    const raced = await run(t, req);
    assert.equal(raced.code, 200, JSON.stringify(raced.body));
    assert.equal(raced.body.duplicate, true);
    assert.equal(raced.body.paid, true);
    assert.equal(b.queries.filter((x) => x.q.includes('INSERT INTO web_orders')).length, 2, 'the reservation was attempted and conflicted');
    assert.equal(b.clover.length, cloverCalls);
    assert.equal(b.redemptions.length, 1, 'still counted once');
    assert.equal(b.ledger?.status, 'paid', 'the row was not disturbed');
  });
});
