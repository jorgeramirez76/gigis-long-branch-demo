import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
process.env.CLOVER_API_TOKEN = 'test-only';
process.env.CLOVER_MERCHANT_ID = 'test-merchant';
delete process.env.CLOVER_PRINT_DEVICE_IDS;
let originalFetch: typeof fetch;
let clover: typeof import('../api/lib/clover.js');
before(async () => { originalFetch = globalThis.fetch; clover = await import('../api/lib/clover.js'); });
afterEach(() => { globalThis.fetch = originalFetch; });
function mockPoll(kind: 'missing' | 'printed' | 'unreachable') {
  let posts = 0;
  globalThis.fetch = (async (_url, init) => {
    if (init?.method === 'POST') { posts++; return new Response(JSON.stringify({ id: 'EVENT1', state: 'CREATED' })); }
    if (kind === 'unreachable') throw new TypeError('mock network failure');
    if (kind === 'missing') return new Response(JSON.stringify({ message: 'The print event is missing' }), { status: 400 });
    return new Response(JSON.stringify({ state: 'PRINTED' }));
  }) as typeof fetch;
  return () => posts;
}
describe('print completion evidence', () => {
  it('accepts Clover missing-event400 as completed without submitting another job', async () => {
    const posts = mockPoll('missing');
    const outcome = await clover.printOrderTicket('ORDER1');
    assert.equal(outcome.printed, true); assert.equal(posts(), 1);
  });
  it('recognizes explicit PRINTED', async () => {
    const posts = mockPoll('printed');
    assert.equal((await clover.printOrderTicket('ORDER1')).printed, true); assert.equal(posts(), 1);
  });
  it('keeps an accepted job queued when the status lookup is unreachable', async () => {
    const posts = mockPoll('unreachable');
    const outcome = await clover.printOrderTicket('ORDER1');
    assert.equal(outcome.printed, false); assert.equal(outcome.queued, true); assert.equal(posts(), 1);
  });
  it('does not resubmit when the original print request loses its response', async () => {
    let posts = 0;
    globalThis.fetch = (async () => { posts++; throw new TypeError('mock lost response'); }) as typeof fetch;
    assert.equal((await clover.printOrderTicket('ORDER1')).printed, false); assert.equal(posts, 1);
  });
});
