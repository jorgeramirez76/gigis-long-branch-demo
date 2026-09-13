import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { hashPassword, validPassword, verifyPassword } from "../api/lib/password.js";
import { ACCOUNT_ORIGIN, sameOrigin, sessionToken, hashToken } from "../api/lib/session.js";
import { accountHandler } from "../api/lib/accountHandler.js";
process.env.DATABASE_URL = "postgres://test:test@fake-neon.test/test";
process.env.ACCOUNTS_ENABLED = "true";
process.env.TURNSTILE_SECRET_KEY = "test-secret";
const originalFetch = globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
const response = () => {
  const state:{status:number;body:unknown;headers:Record<string,unknown>}={status:0,body:null,headers:{}};
  return {state,res:{status(n:number){state.status=n;return this;},json(v:unknown){state.body=v;return this;},setHeader(k:string,v:unknown){state.headers[k]=v;return this;},send(){return this;},end(){return this;}}};
};
function mockStorage() {
  const queries:string[]=[];
  globalThis.fetch=async (url,init)=>{
    if(String(url).includes('challenges.cloudflare.com'))return new Response(JSON.stringify({success:true}));
    assert.ok(String(url).includes('neon') || String(url).includes('api.test'),'No live email, SMS or card calls in security tests');
    const body=JSON.parse(String(init?.body));queries.push(body.query);
    const counter=String(body.query).includes('RETURNING n');
    return new Response(JSON.stringify({command:'SELECT',rowCount:counter?1:0,fields:counter?[{name:'n',dataTypeID:23}]:[],rows:counter?[[1]]:[]}));
  };
  return queries;
}
test('passwords use independent salts, reject truncation and never match a missing account',async()=>{
  assert.equal(validPassword('short'),false);
  assert.equal(validPassword('😀'.repeat(19)),false);
  const value='a long memorable pizza password';const first=await hashPassword(value),second=await hashPassword(value);
  assert.notEqual(first,second);assert.equal(await verifyPassword(value,first),true);
  assert.equal(await verifyPassword('wrong password',first),false);assert.equal(await verifyPassword(value),false);
});
test('cookie parsing and CSRF checks reject malformed and cross-origin requests',()=>{
  assert.equal(sameOrigin({headers:{origin:'https://evil.invalid','content-type':'application/json'}} as never),false);
  assert.equal(sameOrigin({headers:{origin:ACCOUNT_ORIGIN,'content-type':'text/plain'}} as never),false);
  assert.equal(sameOrigin({headers:{origin:ACCOUNT_ORIGIN,'content-type':'application/json'}} as never),true);
  assert.equal(sessionToken({headers:{cookie:'__Host-gigis_session=short'}} as never),null);
  const token='A'.repeat(43);assert.equal(sessionToken({headers:{cookie:`other=x; __Host-gigis_session=${token}`}} as never),token);
  assert.notEqual(hashToken(token),token);assert.equal(hashToken(token).length,64);
});
test('private account history requires a session and is never cached',async()=>{
  mockStorage();const r=response();await accountHandler('orders')({method:'GET',headers:{},query:{}} as never,r.res as never);
  assert.equal(r.state.status,401);assert.equal(r.state.headers['Cache-Control'],'no-store');
});
test('cross-origin account writes fail before any database or provider call',async()=>{
  globalThis.fetch=async()=>{throw new Error('unexpected network');};const r=response();
  await accountHandler('signup')({method:'POST',headers:{origin:'https://evil.invalid'},query:{},body:{}} as never,r.res as never);
  assert.equal(r.state.status,403);
});
test('used or expired reset tokens cannot change credentials',async()=>{
  const queries=mockStorage(),r=response();await accountHandler('password-reset-confirm')({method:'POST',headers:{origin:ACCOUNT_ORIGIN,'content-type':'application/json'},query:{},body:{token:'A'.repeat(43),password:'A valid long password'}} as never,r.res as never);
  assert.equal(r.state.status,400);assert.ok(queries.some(q=>q.includes('used_at IS NULL AND expires_at>now()')));
  assert.ok(!queries.some(q=>q.includes('UPDATE accounts')));
});

// These fixtures intercept every network request and reject non-database traffic.
function storageRows(resolve: (query:string,params:unknown[])=>Record<string,unknown>[]) {
  const queries: {query:string;params:unknown[]}[]=[];
  globalThis.fetch=async(url,init)=>{
    assert.ok((String(url).includes('neon') || String(url).includes('api.test')),'Unexpected provider call');
    const body=JSON.parse(String(init?.body)); queries.push(body);
    const rows=body.query.includes('RETURNING n')?[{n:1}]:resolve(body.query,body.params);
    const keys=Object.keys(rows[0]||{});
    return new Response(JSON.stringify({command:'SELECT',rowCount:rows.length,
      fields:keys.map(name=>({name,dataTypeID:typeof rows[0][name]==='number'?23:typeof rows[0][name]==='boolean'?16:25})),
      rows:rows.map(row=>keys.map(key=>typeof row[key]==='boolean'?(row[key]?'t':'f'):row[key]))}));
  };
  return queries;
}
const sessionRequest=(body:unknown={})=>({method:'POST',headers:{origin:ACCOUNT_ORIGIN,'content-type':'application/json',cookie:'__Host-gigis_session='+'B'.repeat(43)},query:{},body});
const signedIn={id:7,name:'Example',email:'example@example.test',phone:'+15555550101',member_id:9,password_hash:'unused'};
test('reorder cannot read another account order and scopes lookup to store',async()=>{
  const queries=storageRows(q=>q.includes('FROM account_sessions s JOIN accounts')?[signedIn]:[]),r=response();
  await accountHandler('reorder')(sessionRequest({orderId:900}) as never,r.res as never);
  assert.equal(r.state.status,404);
  const query=queries.find(q=>q.query.includes('SELECT items FROM web_orders'))!;
  assert.match(query.query,/account_id=.*AND business=/);assert.ok(query.params.map(String).includes('7'));
});
test('a revoked or credential-version-stale session cannot read private orders',async()=>{
  const queries=storageRows(()=>[]),r=response();
  await accountHandler('orders')({...sessionRequest(),method:'GET'} as never,r.res as never);
  assert.equal(r.state.status,401);
  assert.ok(queries.some(q=>q.query.includes('s.credential_version=a.credential_version')));
  assert.ok(!queries.some(q=>q.query.includes('FROM web_orders')));
});
test('session creation fails closed if a password reset wins the race',async()=>{
  const {createSession}=await import('../api/lib/session.js');
  const queries=storageRows(()=>[]),r=response();
  await assert.rejects(()=>createSession(7,r.res as never,'old-password-hash'),/credentials_changed/);
  assert.equal(r.state.headers['Set-Cookie'],undefined);
  assert.ok(queries.some(q=>q.query.includes('password_hash=')&&q.query.includes('business=')));
});
test('saving already requested SMS preferences does not send another confirmation',async()=>{
  const {CANONICAL_CONSENT_TEXT}=await import('../api/lib/vipSignupShared.js');
  storageRows(q=>q.includes('FROM account_sessions s JOIN accounts')?[signedIn]:q.includes('SELECT * FROM updated')?[{id:9,phone:'+15555550202',sms_requested:true,sms_consent:false}]:[]);
  const r=response();await accountHandler('consent')(sessionRequest({sms:true,email:true,consentText:CANONICAL_CONSENT_TEXT}) as never,r.res as never);
  assert.equal(r.state.status,200);
});
test('deletion loses safely to a concurrent credential change',async()=>{
  const password='Long enough deletion password';
  const password_hash=await hashPassword(password);
  const queries=storageRows(q=>q.includes('FROM account_sessions s JOIN accounts')?[{...signedIn,password_hash}]:[]);
  const r=response();await accountHandler('delete')(sessionRequest({password}) as never,r.res as never);
  assert.equal(r.state.status,409);
  const mutation=queries.find(q=>q.query.includes("email='deleted-'"))!;
  assert.match(mutation.query,/password_hash=\$\d+ RETURNING id/);
  assert.match(mutation.query,/EXISTS\(SELECT 1 FROM changed\)/);
});
