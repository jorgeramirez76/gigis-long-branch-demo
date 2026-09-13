import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';

const script=readFileSync(new URL('../public/account/account.js',import.meta.url),'utf8');
type FixtureElement = {hidden:boolean;textContent:string;disabled:boolean;elements:Record<string,FixtureElement>;querySelector:()=>FixtureElement;replaceChildren:()=>void;append:()=>void;onclick?:()=>Promise<void>};
async function fixture(existing:unknown[],accept:boolean){
  const nodes=new Map<string, FixtureElement>();
  const created:FixtureElement[]=[];
  function element():FixtureElement{return {hidden:false,textContent:'',disabled:false,elements:new Proxy({}, {get:(_t,key)=>get(String(key))}),querySelector:()=>get('formButton'),replaceChildren(){},append(){}};}
  function get(id:string):FixtureElement{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)!;}
  const local=new Map([['gigis_cart_v1',JSON.stringify(existing)]]);
  const session=new Map<string,string>();const confirmations:string[]=[];
  const location={hash:'',search:'',pathname:'/account/',href:'/account/'};
  const reordered=[{itemName:'Garlic Knots',quantity:1}];
  const responses:Record<string,unknown>={config:{siteKey:'fixture',consentText:'Fixture'},me:{account:{name:'Example'},member:{},pie:null,orders:[{id:7,total:500,created_at:'2026-09-12',fulfillment:'pickup',items:reordered}]},reorder:{lines:reordered}};
  runInNewContext(script,{document:{getElementById:get,querySelectorAll:()=>[],createElement:()=>{const node=element();created.push(node);return node;}},window:{addEventListener(){},confirm:(text:string)=>{confirmations.push(text);return accept;}},location,localStorage:{getItem:(key:string)=>local.get(key)||null},sessionStorage:{getItem:(key:string)=>session.get(key)||null,setItem:(key:string,value:string)=>session.set(key,value)},URLSearchParams,Intl,Date,fetch:async(url:string)=>({ok:true,status:200,json:async()=>responses[url.split('/').at(-1)!]})});
  await new Promise(resolve=>setImmediate(resolve));
  const button=created.find(node=>node.textContent==='Reorder');assert.ok(button,'fixture renders the actual reorder button');
  await button.onclick!();return {local,session,confirmations,location,button,reordered};
}
test('cancelling reorder replacement keeps the saved cart and stays on the account page',async()=>{
 const old=[{itemName:'Plain Pizza',quantity:2}],r=await fixture(old,false);
 assert.equal(r.confirmations.length,1);assert.deepEqual(JSON.parse(r.local.get('gigis_cart_v1')!),old);
 assert.equal(r.session.has('gigis_rewards_reorder'),false);assert.equal(r.location.href,'/account/');assert.equal(r.button.disabled,false);
});
test('accepting replacement stages the past order only after confirmation',async()=>{
 const r=await fixture([{itemName:'Plain Pizza',quantity:2}],true);
 assert.equal(r.confirmations.length,1);assert.deepEqual(JSON.parse(r.session.get('gigis_rewards_reorder')!),r.reordered);
 assert.match(r.location.href,/#menu$/);
});
test('an empty cart can reorder without an unnecessary replacement question',async()=>{
 const r=await fixture([],false);assert.equal(r.confirmations.length,0);
 assert.deepEqual(JSON.parse(r.session.get('gigis_rewards_reorder')!),r.reordered);assert.match(r.location.href,/#menu$/);
});
