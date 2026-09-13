import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseMetricBatch, metricSource, metricsOptedOut } from '../src/lib/metricProtocol.js';

test('fixed payload vocabulary rejects extra/private fields, duplicates and oversized batches', () => {
  assert.deepEqual(parseMetricBatch({events:['call_click'],source:'search'}),{events:['call_click'],source:'search'});
  for (const value of [{events:['call_click'],source:'search',email:'private'}, {events:['call_click','call_click'],source:'direct'}, {events:['purchase'],source:'direct'}, {events:[],source:'direct'}, {events:['call_click'],source:'https://google.com/?q=private'}, {events:Array(5).fill('call_click'),source:'direct'}]) assert.equal(parseMetricBatch(value),null);
});
test('source classifier strips all URL detail and does not accept lookalike search hosts', () => {
  assert.equal(metricSource('https://www.google.com/search?q=private','https://shop.test'),'search');
  assert.equal(metricSource('https://google.com.evil.test/private','https://shop.test'),'referral');
  assert.equal(metricSource('https://shop.test/account/?token=private','https://shop.test'),'unknown');
  assert.equal(metricSource('','https://shop.test'),'direct');
  assert.equal(metricsOptedOut({doNotTrack:'1'}),true);
  assert.equal(metricsOptedOut({globalPrivacyControl:true}),true);
});

test('browser sends one bounded batch without URLs or IDs; honors opt-out and ignores duplicate clicks', () => {
  const code=fs.readFileSync(new URL('../public/metrics.js',import.meta.url),'utf8').replace(/^export /gm,'');
  function browser(optOut=false) {
    const listeners: Record<string, () => void> = {};
    const sends: {body:string}[]=[];
    const attrs=new Set<string>();
    class Element {dataset={metric:'checkout_start'}; closest(){return this;} matches(){return false;}}
    class Anchor extends Element {}
    const nav={doNotTrack:optOut?'1':'0',globalPrivacyControl:false};
    const doc={referrer:'https://www.google.com/?q=private',visibilityState:'hidden',documentElement:{hasAttribute:(k:string)=>attrs.has(k),setAttribute:(k:string)=>attrs.add(k)},addEventListener:(k:string,fn:()=>void)=>{listeners[k]=fn;}};
    const win={addEventListener:(k:string,fn:()=>void)=>{listeners[k]=fn;}};
    const context={window:win,document:doc,navigator:nav,location:{pathname:'/',origin:'https://shop.test'},Element,HTMLAnchorElement:Anchor,URL,Set,fetch:async (_u:string,options:{body:string})=>{sends.push(options);},setTimeout:()=>1,clearTimeout:()=>{}};
    vm.runInNewContext(code,context);
    return {listeners,sends,nav,Element};
  }
  const b=browser();
  const click=b.listeners.click as unknown as (e:unknown)=>void;
  click({isTrusted:true,target:new b.Element()}); click({isTrusted:true,target:new b.Element()});
  b.listeners.pagehide();
  assert.equal(b.sends.length,1);
  assert.deepEqual(JSON.parse(b.sends[0].body),{events:['checkout_start'],source:'search'});
  assert.equal(browser(true).listeners.click,undefined);
  const c=browser();(c.listeners.click as unknown as (e:unknown)=>void)({isTrusted:true,target:new c.Element()});c.nav.globalPrivacyControl=true;c.listeners.pagehide();assert.equal(c.sends.length,0);
});

test('API rejects untrusted/private payloads without DB and writes one parameterized aggregate for valid batch', async () => {
  process.env.DATABASE_URL='postgres://test:test@fake-neon.test/db';
  const {default:handler}=await import('../api/metrics.js');
  const originalFetch=globalThis.fetch; const oldDisable=process.env.METRICS_DISABLED;
  const calls:{query:string;params:unknown[]}[]=[];
  globalThis.fetch=(async (_url,init)=>{calls.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({command:'INSERT',rowCount:1,fields:[],rows:[]}));}) as typeof fetch;
  const valid={events:['menu_open','checkout_start'],source:'search'};
  async function run(body:unknown=valid,headers:Record<string,string>={}) {
    let code=0;const res={setHeader(){},status(n:number){code=n;return this;},end(){return this;}};
    await handler({method:'POST',body,headers:{origin:'https://gigislongbranch.com','content-type':'application/json',...headers}} as never,res as never);return code;
  }
  try {
    delete process.env.METRICS_DISABLED;
    assert.equal(await run(valid,{origin:'https://evil.test'}),403);
    assert.equal(await run({...valid,email:'private'}),400);
    assert.equal(await run('x'.repeat(513)),400);
    assert.equal(await run(valid,{'content-length':'513'}),400);
    assert.equal(await run(valid,{dnt:'1'}),204);
    assert.equal(await run(valid,{'sec-gpc':'1'}),204);assert.equal(calls.length,0);
    process.env.METRICS_DISABLED='true';assert.equal(await run(),204);assert.equal(calls.length,0);delete process.env.METRICS_DISABLED;
    assert.equal(await run(),204);assert.equal(calls.length,1);
    assert.ok(calls[0].query.includes('ON CONFLICT'));assert.ok(calls[0].query.includes('10000'));
    assert.ok(calls[0].params.includes('gigis_long_branch'));
    assert.ok(!JSON.stringify(calls).includes('private'));
    globalThis.fetch=(async()=>{throw new Error('database unavailable');}) as typeof fetch;
    assert.equal(await run(),204,'metrics outage must remain best effort');
  } finally {globalThis.fetch=originalFetch;if(oldDisable===undefined)delete process.env.METRICS_DISABLED;else process.env.METRICS_DISABLED=oldDisable;}
});


test('admin report requires configured authentication before querying metrics', async () => {
  const old=process.env.ADMIN_TOKEN; delete process.env.ADMIN_TOKEN;
  const {default:admin}=await import('../api/admin/metrics.js');
  let code=0; let body:unknown;
  const res={setHeader(){},status(n:number){code=n;return this;},json(v:unknown){body=v;return this;},end(){return this;}};
  try {await admin({method:'GET',headers:{}} as never,res as never); assert.equal(code,503);assert.deepEqual(body,{error:'admin_not_configured'});}
  finally {if(old===undefined)delete process.env.ADMIN_TOKEN;else process.env.ADMIN_TOKEN=old;}
});
