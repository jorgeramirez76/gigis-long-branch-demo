import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
process.env.DATABASE_URL = 'postgres://user:pass@fake-neon.test/dbname';
process.env.SMS_WEBHOOK_TOKEN = 'hook-token';
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_SIGNATURE_LOG_ONLY;
const { default: handler, classifySmsKeyword } = await import('../api/sms-inbound.ts');
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_SIGNATURE_LOG_ONLY;
});

describe('which replies revoke SMS consent', () => {
  const table: Array<[string, string]> = [
    // exact carrier keywords, any case or punctuation
    ['STOP', 'stop'], ['Stop.', 'stop'], ['stopall', 'stop'], ['UNSUBSCRIBE', 'stop'], ['cancel', 'stop'], ['End', 'stop'], ['quit!', 'stop'],
    // the FCC's revocation words and plain English
    ['revoke', 'stop'], ['OPTOUT', 'stop'], ['opt out', 'stop'], ['Opt-out please', 'stop'],
    ['please stop', 'stop'], ['Stop texting me', 'stop'], ['can you stop sending these', 'stop'],
    ['remove me from this list', 'stop'], ["don't text me again", 'stop'], ['no more texts', 'stop'],
    // stop always wins over yes
    ['Yes stop texting me', 'stop'], ['YES STOP', 'stop'],
    // the deliberate first-word YES (WORKLIST LB-2) still confirms the double opt-in
    ['YES', 'start'], ['YES!', 'start'], ['yes please', 'start'], ['Start', 'start'], ['unstop', 'start'],
    ['help', 'help'], ['INFO', 'help'],
    // not revocations
    ['please stop by', 'other'], ['what time do you close', 'other'], ['', 'other'],
  ];
  for (const [reply, want] of table) {
    it(`"${reply}" → ${want}`, () => assert.equal(classifySmsKeyword(reply), want));
  }
});

function storage() {
  const queries: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.ok(String(url).includes('neon') || String(url).includes('api.test'), `unexpected provider call ${String(url)}`);
    const { query } = JSON.parse(String(init?.body)) as { query: string };
    queries.push(query);
    const updated = query.includes('UPDATE vip_members');
    return new Response(JSON.stringify({ command: 'SELECT', rowCount: updated ? 1 : 0,
      fields: updated ? [{ name: 'id', dataTypeID: 23 }] : [], rows: updated ? [['42']] : [] }));
  }) as typeof fetch;
  return queries;
}
async function inbound(body: Record<string, string>, headers: Record<string, string> = {}) {
  let code = 0; let sent = '';
  const res = { setHeader() { return this; }, status(v: number) { code = v; return this; }, send(v: string) { sent = v; return this; } };
  await handler({ method: 'POST', url: '/api/sms-inbound?token=hook-token', headers: { host: 'gigislongbranch.com', ...headers },
    query: { token: 'hook-token' }, body: { From: '+17325550100', ...body } } as never, res as never);
  return { code, sent };
}

describe('the inbound webhook', () => {
  it('a plain-English stop flips consent, records it, and confirms once', async () => {
    const queries = storage();
    const { code, sent } = await inbound({ Body: 'please stop texting me' });
    assert.equal(code, 200);
    assert.ok(queries.some((q) => /UPDATE vip_members SET sms_consent = FALSE/.test(q)));
    assert.ok(queries.some((q) => q.includes("'opt_out', 'sms_stop'")));
    assert.match(sent, /<Message>Gigi's VIP Club: you're unsubscribed/);
  });

  it('an exact STOP is confirmed by Twilio itself, so our reply stays empty', async () => {
    storage();
    const { sent } = await inbound({ Body: 'STOP' });
    assert.doesNotMatch(sent, /<Message>/);
  });

  it("honors Twilio's OptOutType so our flags match what Twilio blocks", async () => {
    const queries = storage();
    const { sent } = await inbound({ Body: 'halt', OptOutType: 'STOP' });
    assert.ok(queries.some((q) => /UPDATE vip_members SET sms_consent = FALSE/.test(q)));
    assert.doesNotMatch(sent, /<Message>/, 'Twilio already confirmed it');
  });

  it('with TWILIO_SIGNATURE_LOG_ONLY a bad signature is logged, not refused; without it, refused', async () => {
    storage();
    process.env.TWILIO_AUTH_TOKEN = 'auth-token';
    process.env.TWILIO_SIGNATURE_LOG_ONLY = '1';
    assert.equal((await inbound({ Body: 'STOP' }, { 'x-twilio-signature': 'bogus' })).code, 200);
    delete process.env.TWILIO_SIGNATURE_LOG_ONLY;
    assert.equal((await inbound({ Body: 'STOP' }, { 'x-twilio-signature': 'bogus' })).code, 403);
  });
});
