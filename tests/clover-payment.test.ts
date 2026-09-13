import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import ts from 'typescript';

const originalWindow = globalThis.window;
afterEach(() => { globalThis.window = originalWindow; });
let sequence = 0;
/** Compile the browser module with explicit Vite env values and a fake hosted SDK.
 * This exercises the actual public card API without loading Clover or collecting card data. */
async function paymentModule(off: string, createToken: () => Promise<unknown>) {
  const source = readFileSync(new URL('../src/ordering/cloverPayment.ts', import.meta.url), 'utf8')
    .replaceAll('import.meta.env', JSON.stringify({ VITE_CLOVER_PAKMS_KEY: 'test-public', VITE_CLOVER_MERCHANT_ID: 'test-merchant', VITE_CLOVER_APPLE_PAY: '1', VITE_CARD_PAYMENTS_OFF: off }));
  class Clover {
    elements() { return { create: () => ({}) }; }
    createToken = createToken;
  }
  globalThis.window = { Clover, ApplePaySession: { canMakePayments: () => true } } as unknown as Window & typeof globalThis;
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled + `\n// instance ${sequence++}`).toString('base64')}`) as Promise<typeof import('../src/ordering/cloverPayment.js')>;
}
test('the kill switch disables hosted card fields and Apple Pay despite configured keys', async () => {
  const payment = await paymentModule('1', async () => ({ token: 'clv_test' }));
  assert.equal(payment.cardPaymentsKilled(), true);
  assert.equal(payment.cardPaymentEnabled(), false);
  assert.equal(payment.applePayAvailable(), false);
  await assert.rejects(payment.initCloverCard(), /not enabled/);
});
test('a stuck hosted token request times out and a later retry can succeed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0;
  const payment = await paymentModule('', () => ++attempts === 1 ? new Promise(() => {}) : Promise.resolve({ token: 'clv_retry' }));
  const card = await payment.initCloverCard();
  const pending = card.tokenize();
  const rejected = assert.rejects(pending, /card form didn't respond.*732.*377-2468/);
  t.mock.timers.tick(10000);
  await rejected;
  assert.equal(await card.tokenize(), 'clv_retry');
  assert.equal(attempts, 2);
});
test('normal token and validation responses retain their existing behavior', async () => {
  let response: unknown = { token: 'clv_test' };
  const payment = await paymentModule('', async () => response);
  assert.equal(payment.cardPaymentEnabled(), true);
  const card = await payment.initCloverCard();
  assert.equal(await card.tokenize(), 'clv_test');
  response = { errors: { cardNumber: 'Please check the card number.' } };
  await assert.rejects(card.tokenize(), /Please check the card number/);
});
