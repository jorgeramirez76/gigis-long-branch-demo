import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import handler from "../api/admin/broadcast.js";
process.env.DATABASE_URL="postgres://test:test@fake-neon.test/test";
process.env.ADMIN_TOKEN="broadcast-test-token";
process.env.TWILIO_ACCOUNT_SID="test-account";
process.env.TWILIO_AUTH_TOKEN="test-secret";
process.env.TWILIO_FROM_NUMBER="+15551230001";
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
const firstId="12345678-1234-4123-8123-123456789012";
const secondId="12345678-1234-4123-8123-123456789013";
function response(){const state:{status:number;body:Record<string,unknown>}={status:0,body:{}};return {state,res:{status(n:number){state.status=n;return this;},json(v:Record<string,unknown>){state.body=v;return this;},setHeader(){return this;}}};}
const request=(requestId=firstId)=>({method:"POST",headers:{"x-admin-token":"broadcast-test-token"},query:{},body:{business:"gigis_long_branch",message:"Test fixture offer",channels:{sms:true,email:false},requestId}});
function storage(opts:{transportFailure?:boolean;auditFailure?:boolean;startFailure?:boolean}={}){
  const rows:{id:number;requestId:string;contentKey:string;started:boolean;completed:boolean;sent:number;failed:number}[]=[];
  let sends=0,startFailed=false;
  function result(data:Record<string,unknown>[]=[]){const names=Object.keys(data[0]??{});return new Response(JSON.stringify({command:"SELECT",rowCount:data.length,fields:names.map(name=>({name,dataTypeID:typeof data[0]?.[name]==="number"?23:25})),rows:data.map(r=>names.map(n=>r[n]))}));}
  globalThis.fetch=async(url,init)=>{
    if(String(url).includes("api.twilio.com")) {sends++;if(opts.transportFailure)throw new Error("fixture connection lost after submission");return new Response(JSON.stringify({sid:"fixture-sid"}));}
    assert.ok((String(url).includes("neon") || String(url).includes("api.test")),"Unexpected real provider call");
    const {query:q,params:p}=JSON.parse(String(init?.body));
    if(q.includes("RETURNING n"))return result([{n:1}]);
    if(q.includes("SELECT id, name, phone, email FROM vip_members"))return result([{id:1,name:"Fixture",phone:"+15551230000",email:null}]);
    if(q.includes("LEFT JOIN vip_sends")){const r=rows.find(r=>r.requestId===p[0]);return result(r?[{id:r.id,content_key:r.contentKey,delivery_started_at:r.started?"started":null,completed_at:r.completed?"completed":null,sms_sent:r.sent,sms_failed:r.failed,email_sent:0,email_failed:0}]:[]);}
    if(q.includes("SELECT b.id FROM broadcasts"))return result([]);
    if(q.includes("INSERT INTO broadcasts")){
      if(rows.some(r=>r.requestId===p[7]||(!r.completed&&r.contentKey===p[8])))return result();
      const r={id:rows.length+1,requestId:p[7],contentKey:p[8],started:false,completed:false,sent:0,failed:0};rows.push(r);return result([{id:r.id}]);
    }
    if(q.includes("SET delivery_started_at")){
      if(opts.startFailure&&!startFailed){startFailed=true;throw new Error("fixture DB failed before provider call");}
      const r=rows.find(r=>r.id===Number(p[0])&&r.requestId===p[1]&&!r.started);if(!r)return result();r.started=true;return result([{id:r.id}]);
    }
    if(q.includes("INSERT INTO vip_sends")){if(opts.auditFailure)throw new Error("fixture audit lost");const r=rows.find(r=>r.id===Number(p[4]))!;if(p[5]==="sent")r.sent++;else r.failed++;return result();}
    if(q.includes("SET completed_at")){rows.find(r=>r.id===Number(p[0]))!.completed=true;return result();}
    return result();
  };
  return {rows,get sends(){return sends;}};
}
async function run(id=firstId){const r=response();await handler(request(id) as never,r.res as never);return r.state;}
test("concurrent requests with one action ID make only one provider submission",async()=>{const db=storage();const results=await Promise.all([run(),run()]);assert.equal(db.sends,1);assert.ok(results.every(r=>r.status===200));assert.ok(results.some(r=>r.body.duplicate));});
test("an uncertain submission blocks same-action and fresh-ID replays even with no sent audit",async()=>{const db=storage({transportFailure:true});await run();const replay=await run();const fresh=await run(secondId);assert.equal(db.sends,1);assert.equal(replay.body.duplicate,true);assert.equal(replay.body.inProgress,true);assert.equal(fresh.status,409);assert.equal(db.rows[0].completed,false);});
test("a failure before starting delivery can safely retry the reserved action",async()=>{const db=storage({startFailure:true});assert.equal((await run()).status,500);assert.equal(db.sends,0);assert.equal((await run()).status,200);assert.equal(db.sends,1);});
test("successful provider submission with lost audit stays reserved",async()=>{const db=storage({auditFailure:true});await run();await run();const fresh=await run(secondId);assert.equal(db.sends,1);assert.equal(fresh.status,409);assert.equal(db.rows[0].completed,false);});
test("simultaneous fresh IDs for identical content cannot both submit",async()=>{const db=storage();const results=await Promise.all([run(),run(secondId)]);assert.equal(db.sends,1);assert.ok(results.some(r=>r.status===409));});
