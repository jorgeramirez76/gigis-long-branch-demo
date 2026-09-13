import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {afterEach,test} from 'node:test';
import {accountHandler} from '../api/lib/accountHandler.js';
import {ACCOUNT_ORIGIN,hashToken} from '../api/lib/session.js';
const originalFetch=globalThis.fetch;
process.env.DATABASE_URL='postgres://test:test@fake-neon.test/test';
process.env.ACCOUNTS_ENABLED='true';process.env.TURNSTILE_SECRET_KEY='fixture';
process.env.RESEND_API_KEY='fixture';process.env.EMAIL_FROM='fixture@example.test';
afterEach(()=>{globalThis.fetch=originalFetch;});
const response=()=>{const state:{status:number;body:unknown;headers:Record<string,unknown>}={status:0,body:null,headers:{}};return {state,res:{status(n:number){state.status=n;return this;},json(value:unknown){state.body=value;return this;},setHeader(key:string,value:unknown){state.headers[key]=value;return this;}}};};
const req=(body:unknown)=>({method:'POST',headers:{origin:ACCOUNT_ORIGIN,'content-type':'application/json'},query:{},body});
function databaseReply(rows:Record<string,unknown>[]){const keys=Object.keys(rows[0]||{});return new Response(JSON.stringify({command:'SELECT',rowCount:rows.length,fields:keys.map(name=>({name,dataTypeID:typeof rows[0][name]==='number'?23:25})),rows:rows.map(row=>keys.map(key=>row[key]))}));}
test('reset requests keep account existence private and email only a hashed-at-rest expiring token',async()=>{
 let known=true;const emails:{html:string;text:string}[]=[];const queries:{query:string;params:unknown[]}[]=[];
 globalThis.fetch=async(url,init)=>{
  const target=String(url);
  if(target.includes('challenges.cloudflare.com'))return new Response(JSON.stringify({success:true}));
  if(target==='https://api.resend.com/emails'){emails.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({id:'fixture'}));}
  assert.ok(target.includes('neon')||target.includes('api.test'),'No unexpected provider requests');
  const body=JSON.parse(String(init?.body));queries.push(body);
  return databaseReply(body.query.includes('RETURNING n')?[{n:1}]:known&&body.query.includes('SELECT id FROM accounts')?[{id:7}]:[]);
 };
 const found=response();await accountHandler('password-reset-request')(req({email:'OWNER@example.test',turnstileToken:'fixture'}) as never,found.res as never);
 known=false;const absent=response();await accountHandler('password-reset-request')(req({email:'absent@example.test',turnstileToken:'fixture'}) as never,absent.res as never);
 assert.equal(found.state.status,200);assert.equal(absent.state.status,200);assert.deepEqual(found.state.body,absent.state.body);assert.equal(emails.length,1);
 const token=emails[0].text.match(/#token=([A-Za-z0-9_-]{43})/)?.[1];assert.ok(token);
 const parked=queries.find(row=>row.query.includes('INSERT INTO account_tokens'))!;
 assert.ok(parked.params.includes(hashToken(token)));assert.ok(!parked.params.includes(token));assert.match(parked.query,/interval '30 minutes'/);
});
test('a confirmed reset changes credentials atomically and revokes previous sessions and links',async()=>{
 const queries:string[]=[];
 globalThis.fetch=async(url,init)=>{
  assert.ok(String(url).includes('neon')||String(url).includes('api.test'));
  const body=JSON.parse(String(init?.body));queries.push(body.query);
  if(body.query.includes('RETURNING n'))return databaseReply([{n:1}]);
  if(body.query.includes('SELECT email,purpose,payload FROM account_tokens'))return databaseReply([{email:'owner@example.test',purpose:'reset',payload:'{}'}]);
  if(body.query.includes('WITH token AS')||body.query.includes('INSERT INTO account_sessions'))return databaseReply([{id:7}]);
  return databaseReply([]);
 };
 const r=response();await accountHandler('password-reset-confirm')(req({token:'A'.repeat(43),password:'Synthetic reset test password'}) as never,r.res as never);
 assert.equal(r.state.status,200);const mutation=queries.find(query=>query.includes('WITH token AS'))!;
 assert.match(mutation,/used_at IS NULL AND expires_at>now()/);assert.match(mutation,/credential_version=credential_version\+1/);
 assert.match(mutation,/DELETE FROM account_sessions/);assert.match(mutation,/token_hash<>/);assert.match(String(r.state.headers['Set-Cookie']),/HttpOnly; Secure; SameSite=Lax/);
});
test('a visitor with an expired reset link can request a new link without being trapped by missing verification',async()=>{
 type Node={hidden:boolean;textContent:string;required:boolean;elements:Record<string,Node>;onclick?:()=>void};
 const nodes=new Map<string,Node>();const appended:unknown[]=[];
 const get=(id:string):Node=>{if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',required:false,elements:new Proxy({}, {get:(_t,key)=>get(String(key))})});return nodes.get(id)!;};
 runInNewContext(readFileSync(new URL('../public/account/account.js',import.meta.url),'utf8'),{
  document:{getElementById:get,querySelectorAll:()=>[],createElement:()=>({}),head:{append:(node:unknown)=>appended.push(node)}},
  window:{addEventListener(){},innerWidth:390},location:{hash:'#token='+'A'.repeat(43),search:'',pathname:'/account/'},URLSearchParams,
  fetch:async()=>({ok:true,json:async()=>({siteKey:'fixture',consentText:'Fixture'})})
 });
 await new Promise(resolve=>setImmediate(resolve));assert.equal(get('forgot').hidden,false);assert.equal(get('forgot').textContent,'Request a new password link');assert.equal(appended.length,0);
 get('forgot').onclick!();assert.equal(get('submit').textContent,'Send reset link');assert.equal(appended.length,1);assert.equal(get('challenge').hidden,false);assert.equal(get('password').required,false);
});
