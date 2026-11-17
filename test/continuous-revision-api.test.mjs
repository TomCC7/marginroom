// Real HTTP and disposable on-disk SQLite; never touches repository documents.
import assert from 'node:assert/strict';
import {test} from './helpers/check.mjs';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {openDb,addSuggestion} from '../db.js';
process.env.OWNER_KEY='continuous-disposable-owner';
process.env.SESSION_SECRET='continuous-disposable-secret';
process.env.MMW_WRITE_PER_MIN='10000';process.env.MMW_READ_PER_MIN='10000';
const dir=await mkdtemp(path.join(process.env.TMPDIR||tmpdir(),'continuous-'));
process.env.HS_DOCS_DIR=dir;
const {createApp}=await import('../server.js');
const file=path.join(dir,'fixture.html'),dbFile=path.join(dir,'test.db');
const original='<html><body><p>A <strong>cat</strong> and a <em>dog</em>.</p><p>A <strong>cat</strong> and a <em>dog</em>.</p></body></html>';
const text='A cat and a dog.';
const anchor=createHash('sha256').update(text).digest('hex');
let db=openDb(dbFile),server,base;
async function start(){server=await new Promise(resolve=>{const s=createApp(db).listen(0,'127.0.0.1',()=>resolve(s))});base=`http://127.0.0.1:${server.address().port}`}
async function stop(){await new Promise(resolve=>server.close(resolve))}
function client(owner=false){const jar=new Map();return async(method,url,body)=>{const headers={'content-type':'application/json'};if(owner)headers['x-owner-key']=process.env.OWNER_KEY;if(jar.size)headers.cookie=[...jar].map(([k,v])=>`${k}=${v}`).join('; ');const r=await fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});for(const c of r.headers.getSetCookie()){const p=c.split(';')[0],i=p.indexOf('=');jar.set(p.slice(0,i),p.slice(i+1))}return {status:r.status,data:await r.json()}}}
const a=client(),b=client(),owner=client(true);
const get=(who=a,anc=anchor)=>who('GET',`/api/revision/fixture?anchor=${encodeURIComponent(anc)}`);
let request=0;
const payload=(s,proposedText)=>({anchor:s.anchor,version:s.version,sourceHash:s.sourceHash,proposedText,requestId:`revision-${++request}`,author:'<same name>'});
async function save(s,t,who=a){return who('POST','/api/revision/fixture',payload(s,t))}
async function reset(){db.prepare('DELETE FROM suggestions').run();db.prepare('DELETE FROM documents').run();await writeFile(file,original)}
try{await writeFile(file,original);await start();
await test('authoritative snapshot, occurrence, unsupported anchors, escaped public ownership',async()=>{
 const s=await get();assert.equal(s.status,200);assert.equal(s.data.baseText,text);assert.equal(s.data.proposedText,text);assert.equal((await get(a,anchor+'#1')).data.baseText,text);assert.equal((await get(a,'generated')).status,422);
 const r=await save(s.data,'A CAT and a DOG.');assert.equal(r.status,200);assert.equal(r.data.snapshot.records.filter(x=>x.status==='open').length,2);
 assert.ok(r.data.snapshot.records.every(x=>x.canUpdate&&x.author==='&lt;same name&gt;'&&!('request_caller'in x)&&!('request_payload'in x)));
 const other=(await get(b)).data;assert.equal(other.proposedText,text);assert.ok(other.records.every(x=>!x.canUpdate));
 const conflict=await save(other,'A CAT and a dog.',b);assert.equal(conflict.status,409);assert.equal(conflict.data.existingId,other.records[0].id);
});
await test('two hunks reentry updates stable IDs/replies, unchanged noop, withdrawal and retained history',async()=>{
 await reset();let s=(await save((await get()).data,'A CAT and a DOG.')).data.snapshot;const ids=s.records.map(x=>x.id),created=s.records[0].created_at;
 await b('POST',`/api/suggest/fixture/${ids[0]}/replies`,{body:'discussion'});s=(await get()).data;
 const unchanged=await save(s,s.proposedText);assert.equal(unchanged.data.snapshot.version,s.version);
 s=(await save(s,'A CATS and a DOG.')).data.snapshot;assert.deepEqual(s.records.map(x=>x.id),ids);assert.equal(s.records[0].created_at,created);assert.equal(s.records[0].replies.length,1);
 s=(await save(s,'A cat and a DOG.')).data.snapshot;assert.equal(s.records.find(x=>x.id===ids[0]).status,'withdrawn');assert.equal(s.records.find(x=>x.id===ids[1]).status,'open');assert.equal(s.records.find(x=>x.id===ids[0]).replies.length,1);
 assert.ok(db.prepare('SELECT count(*) n FROM rewrite_history').get().n>=4);
});
await test('stale versions reject accept-midflight and ABA, immutable idempotent receipts survive later writes/reopen',async()=>{
 await reset();const initial=(await get()).data,p=payload(initial,'A CAT and a dog.');const first=await a('POST','/api/revision/fixture',p);assert.equal(first.status,200);
 assert.equal((await save(initial,'A cat and a DOG.')).status,409);
 const sid=first.data.snapshot.records[0].id;assert.equal((await owner('POST',`/api/suggest/fixture/${sid}/accept`,{})).status,200);
 assert.equal((await save(first.data.snapshot,'A CATS and a dog.')).status,409);
 assert.deepEqual((await a('POST','/api/revision/fixture',p)).data,first.data);
 assert.equal((await a('POST','/api/revision/fixture',{...p,proposedText:text})).status,409);
 await stop();db.close();db=openDb(dbFile);await start();assert.deepEqual((await a('POST','/api/revision/fixture',p)).data,first.data);
 const before=(await get()).data;db.prepare("UPDATE suggestions SET status='rejected' WHERE id=?").run(sid);db.prepare("UPDATE suggestions SET status='accepted' WHERE id=?").run(sid);assert.notEqual((await get()).data.version,before.version);
});
await test('disjoint caller and legacy records, accept both orders rebases exact ranges without source changes',async()=>{
 for(const reverse of [false,true]){await reset();const x=(await save((await get()).data,'A CAT and a dog.')).data.snapshot.records[0];
 const legacy={anchor,quote:'dog',body:'DOG',kind:'rewrite',baseText:text,spanOcc:0,requestId:`legacy-${reverse}`};
 const y=await b('POST','/api/suggest/fixture',legacy);assert.equal(y.status,200);assert.equal((await get()).data.proposedText,'A CAT and a dog.');
 assert.equal(await readFile(file,'utf8'),original);assert.deepEqual((await owner('GET','/api/doc/fixture')).data.overlay,{});
 for(const id of (reverse?[y.data.suggestion.id,x.id]:[x.id,y.data.suggestion.id]))assert.equal((await owner('POST',`/api/suggest/fixture/${id}/accept`,{})).status,200);
 assert.equal((await get()).data.baseText,'A CAT and a DOG.');assert.equal(await readFile(file,'utf8'),original);
 assert.equal((await b('POST','/api/suggest/fixture',legacy)).data.suggestion.id,y.data.suggestion.id);
 }
});
await test('partial accept rebases remaining hunk and continued editing preserves its discussion',async()=>{
 await reset();let s=(await save((await get()).data,'A CATS and a DOG.')).data.snapshot;
 const first=s.records.find(r=>r.quote==='cat'),remaining=s.records.find(r=>r.quote==='dog');
 assert.equal((await b('POST',`/api/suggest/fixture/${remaining.id}/replies`,{body:'dog discussion'})).status,200);
 const before=(await get()).data;assert.equal((await owner('POST',`/api/suggest/fixture/${first.id}/accept`,{})).status,200);
 assert.equal((await save(before,'A CATS and a DOGS.')).status,409);
 s=(await get()).data;assert.equal(s.baseText,'A CATS and a dog.');assert.equal(s.proposedText,'A CATS and a DOG.');
 const kept=s.records.find(r=>r.id===remaining.id);assert.equal(kept.range_start,13);assert.equal(kept.replies.length,1);
 s=(await save(s,'A CATS and a DOGS.')).data.snapshot;assert.equal(s.records.find(r=>r.id===remaining.id).body,'DOGS');assert.equal(s.records.find(r=>r.id===remaining.id).replies.length,1);
 assert.equal((await owner('POST',`/api/suggest/fixture/${remaining.id}/accept`,{})).status,200);
 assert.equal((await get()).data.baseText,'A CATS and a DOGS.');assert.equal(await readFile(file,'utf8'),original);
});
await test('legacy request payload immutable through continuous updates; NULL caller is never claimed',async()=>{
 await reset();const p={anchor,quote:'cat',body:'CAT',kind:'rewrite',baseText:text,rangeStart:2,rangeEnd:5,requestId:'legacy-owned'};
 const row=(await a('POST','/api/suggest/fixture',p)).data.suggestion;const immutable=db.prepare('SELECT request_payload FROM suggestions WHERE id=?').get(row.id).request_payload;
 const changed=await save((await get()).data,'A CATS and a dog.');assert.equal(changed.status,200);assert.equal(changed.data.snapshot.records[0].id,row.id);assert.equal(db.prepare('SELECT request_payload FROM suggestions WHERE id=?').get(row.id).request_payload,immutable);assert.equal((await a('POST','/api/suggest/fixture',p)).data.suggestion.id,row.id);
 db.prepare('UPDATE suggestions SET request_caller=NULL WHERE id=?').run(row.id);assert.equal((await get()).data.records[0].canUpdate,false);assert.equal((await get()).data.proposedText,text);
});
await test('ambiguous split/merge retires IDs without moving or duplicating discussions',async()=>{
 await reset();await writeFile(file,'<p>abcdef</p>');const anc=createHash('sha256').update('abcdef').digest('hex');
 let s=(await save((await get(a,anc)).data,'aWXYZf')).data.snapshot;const old=s.records[0].id;
 await b('POST',`/api/suggest/fixture/${old}/replies`,{body:'original discussion'});
 s=(await save((await get(a,anc)).data,'aWcdeZf')).data.snapshot;
 const split=s.records.filter(r=>r.status==='open');assert.equal(split.length,2);assert.ok(split.every(r=>r.id!==old&&r.replies.length===0));assert.equal(s.records.find(r=>r.id===old).status,'withdrawn');assert.equal(s.records.find(r=>r.id===old).replies.length,1);
 s=(await save(s,'aWXYZf')).data.snapshot;const merged=s.records.filter(r=>r.status==='open');assert.equal(merged.length,1);assert.ok(!split.some(r=>r.id===merged[0].id));assert.equal(s.records.find(r=>r.id===old).replies.length,1);
 assert.throws(()=>db.prepare("UPDATE rewrite_history SET operation='x'").run(),/append_only_history/);assert.throws(()=>db.prepare('DELETE FROM rewrite_history').run(),/append_only_history/);
});
await test('concurrent saves serialize; foreign actual overlap is atomic and disjoint changes stay independent',async()=>{
 await reset();const s=(await get()).data;const attempts=await Promise.all([save(s,'A CAT and a dog.'),save(s,'A cat and a DOG.')]);assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);
 await reset();let first=(await save((await get()).data,'A CAT and a dog.')).data.snapshot;let other=(await get(b)).data;
 const version=other.version,rows=db.prepare('SELECT count(*) n FROM suggestions').get().n;
 const denied=await save(other,'A CATS and a DOG.',b);assert.equal(denied.status,409);assert.equal(denied.data.error,'range_overlap');assert.equal(db.prepare('SELECT count(*) n FROM suggestions').get().n,rows);assert.equal((await get(b)).data.version,version);
 const safe=await save((await get(b)).data,'A cat and a DOG.',b);assert.equal(safe.status,200);assert.equal((await get()).data.proposedText,'A CAT and a dog.');assert.equal((await get(b)).data.proposedText,'A cat and a DOG.');
 // No request ID on the old API must still persist authenticated ownership.
 await reset();const legacy=await a('POST','/api/suggest/fixture',{anchor,kind:'rewrite',baseText:text,quote:'cat',body:'CAT',rangeStart:2,rangeEnd:5,author:'<same name>'});assert.equal(legacy.status,200);assert.equal((await get()).data.records[0].canUpdate,true);assert.equal((await get(b)).data.records[0].canUpdate,false);
});
await test('server ignores forged base and rejects generated/grouped scopes and invalid payloads',async()=>{
 await reset();const s=(await get()).data;const forged={...payload(s,'A CAT and a dog.'),baseText:'attacker text',request_caller:'owner'};
 const saved=await a('POST','/api/revision/fixture',forged);assert.equal(saved.status,200);assert.equal(saved.data.snapshot.baseText,text);assert.equal(saved.data.snapshot.records[0].quote,'cat');
 for(const patch of [{requestId:''},{requestId:'bad id'},{proposedText:null},{version:null},{sourceHash:null}])assert.equal((await a('POST','/api/revision/fixture',{...payload(saved.data.snapshot,text),...patch})).status,400);
 await reset();await writeFile(file,'<section data-hs-group><p>one</p><p>two</p></section>');const group=createHash('sha256').update('one\ntwo').digest('hex');assert.equal((await get(a,group)).status,422);
 await writeFile(file,'<script>document.write("<p>runtime</p>")</script>');assert.equal((await get(a,createHash('sha256').update('runtime').digest('hex'))).status,422);
});
await test('raw UTF-16 whitespace/entities and rich inline source resolve with viewer anchors',async()=>{
 await reset();const value='  😀 cafe\u0301 & <tag>  ';await writeFile(file,'<p>  😀 <strong>café</strong> &amp; &lt;tag&gt;  </p>');const anc=createHash('sha256').update(value.replace(/\s+/g,' ').trim()).digest('hex');
 const s=(await get(a,anc)).data;assert.equal(s.baseText,value);
 const r=await save(s,'  😀 CAFE\u0301 & <tag>  ');assert.equal(r.status,200);assert.equal(r.data.snapshot.proposedText,'  😀 CAFE\u0301 & <tag>  ');assert.ok(r.data.snapshot.records.every(x=>x.range_start>=5));
 for(const record of r.data.snapshot.records)assert.equal((await owner('POST',`/api/suggest/fixture/${record.id}/accept`,{})).status,200);
 assert.equal((await get(a,anc)).data.baseText,'  😀 CAFE\u0301 & <tag>  ');
});
await test('source drift and view-only restrictions fail closed without modifying drafts',async()=>{
 await reset();const s=(await get()).data;await writeFile(file,original+'<!--source changed-->');assert.equal((await save(s,'A CAT and a dog.')).status,409);
 await writeFile(file,'<p>Entirely replaced paragraph</p>');assert.equal((await save(s,'A CAT and a dog.')).status,409);await writeFile(file,original);
 await owner('PUT','/api/access/fixture',{level:'view'});assert.equal((await get()).status,403);assert.equal((await save(s,'x')).status,403);assert.equal((await get(owner)).status,200);
 await owner('PUT','/api/access/fixture',{level:'suggest'});
});
await test('legacy real anchors validate authoritative source and accepted overlay, never client-invented bases',async()=>{
 const modes=[{rangeStart:0,rangeEnd:3,quote:'bad'},{spanOcc:0,quote:'bad'},{spanOcc:-1,quote:'bad'}];
 for(const mode of modes){
  await reset();const before=(await get()).data.version;
  const forged=await a('POST','/api/suggest/fixture',{anchor,kind:'rewrite',baseText:'bad',body:'forged',...mode});
  assert.equal(forged.status,409);assert.equal(forged.data.error,'span_stale');
  assert.equal((await get()).data.version,before);assert.equal(db.prepare('SELECT count(*) n FROM suggestions').get().n,0);
 }
 for(const mode of [{rangeStart:2,rangeEnd:5},{spanOcc:0},{spanOcc:-1}]){
  await reset();const saved=await a('POST','/api/suggest/fixture',{anchor,kind:'rewrite',baseText:text,quote:'cat',body:'CAT',...mode});assert.equal(saved.status,200);
  assert.equal((await owner('POST',`/api/suggest/fixture/${saved.data.suggestion.id}/accept`,{})).status,200);
  assert.equal((await get()).data.baseText,mode.spanOcc===-1?'CAT':'A CAT and a dog.');
 }
 // The accepted overlay, not the original source or supplied base, wins.
 await reset();let s=(await save((await get()).data,'A CAT and a dog.')).data.snapshot;
 assert.equal((await owner('POST',`/api/suggest/fixture/${s.records[0].id}/accept`,{})).status,200);
 assert.equal((await b('POST','/api/suggest/fixture',{anchor,kind:'rewrite',baseText:text,quote:'dog',body:'DOG',spanOcc:0})).status,409);
 const valid=await b('POST','/api/suggest/fixture',{anchor,kind:'rewrite',baseText:'A CAT and a dog.',quote:'dog',body:'DOG',spanOcc:0});assert.equal(valid.status,200);
 assert.equal((await owner('POST',`/api/suggest/fixture/${valid.data.suggestion.id}/accept`,{})).status,200);
 assert.equal((await get()).data.baseText,'A CAT and a DOG.');
 // Even a correctly-shaped SHA with no source target cannot forge an overlay.
 await reset();const missing='0'.repeat(64);
 assert.equal((await a('POST','/api/suggest/fixture',{anchor:missing,kind:'rewrite',baseText:'bad',quote:'bad',body:'forged',spanOcc:-1})).status,409);
});
await test('accept independently rechecks real authoritative bases, including NULL-hash legacy drift',async()=>{
 for(const sourceHash of [null,createHash('sha256').update(original).digest('hex')])for(const mode of [{range_start:0,range_end:3},{span_occ:0},{span_occ:-1}]){
  await reset();const id=`injected-${++request}`;
  addSuggestion(db,{id,author:'legacy',doc_id:'fixture',anchor,kind:'rewrite',base_text:'bad',quote:'bad',body:'forged',created_at:new Date().toISOString(),...mode});
  db.prepare('UPDATE suggestions SET source_hash=? WHERE id=?').run(sourceHash,id);
  const denied=await owner('POST',`/api/suggest/fixture/${id}/accept`,{});assert.equal(denied.status,409);assert.equal(denied.data.error,'span_stale');
  assert.deepEqual((await owner('GET','/api/doc/fixture')).data.overlay,{});assert.equal(db.prepare('SELECT status FROM suggestions WHERE id=?').get(id).status,'stale');
 }
 for(const mode of [{range_start:2,range_end:5},{span_occ:0},{span_occ:-1}]){
  await reset();const id=`drift-${++request}`;addSuggestion(db,{id,author:'legacy',doc_id:'fixture',anchor,kind:'rewrite',base_text:text,quote:'cat',body:'CAT',created_at:new Date().toISOString(),...mode});
  for(const drift of ['<p>Changed authoritative text</p>',original.replaceAll('A <strong>',' A <strong>')]){
   await writeFile(file,drift);
   assert.equal((await owner('POST',`/api/suggest/fixture/${id}/accept`,{})).status,409);
   assert.deepEqual((await owner('GET','/api/doc/fixture')).data.overlay,{});
   // Reopen only the disposable fixture to independently exercise normalized-anchor drift.
   db.prepare("UPDATE suggestions SET status='open' WHERE id=?").run(id);
  }
 }
});
await test('wholeblock substring quotes and packed multiblock rewrites protect full mutation scopes in both API directions',async()=>{
 const legacy=[{anchor,spanOcc:-1,quote:'cat',baseText:text,body:'replacement'},
  {anchor:`m:${anchor},${anchor}#1`,spanOcc:-2,quote:`${text}\n\n${text}`,baseText:`${text}\n\n${text}`,body:'first\n\nsecond'}];
 for(const input of legacy)for(const continuousFirst of [false,true]){
  await reset();let existing;
  if(continuousFirst){existing=(await save((await get()).data,'A cat and a DOG.')).data.snapshot.records[0].id;
   const denied=await b('POST','/api/suggest/fixture',{kind:'rewrite',...input});assert.equal(denied.status,409);assert.equal(denied.data.existingId,existing);
  }else{const saved=await b('POST','/api/suggest/fixture',{kind:'rewrite',...input});assert.equal(saved.status,200);existing=saved.data.suggestion.id;
   const denied=await save((await get()).data,'A cat and a DOG.');assert.equal(denied.status,409);assert.equal(denied.data.existingId,existing);
   if(input.spanOcc===-2){const deniedSecond=await save((await get(a,anchor+'#1')).data,'A cat and a DOG.');assert.equal(deniedSecond.status,409);assert.equal(deniedSecond.data.existingId,existing)}
  }
  assert.equal(db.prepare("SELECT count(*) n FROM suggestions WHERE status='open'").get().n,1);
 }
 // A whole-block owned projection must also use its full scope, not its quote.
 await reset();assert.equal((await a('POST','/api/suggest/fixture',{kind:'rewrite',...legacy[0]})).status,200);assert.equal((await get()).data.proposedText,'replacement');
});
await test('legacy occurrence and exact ranges reject true overlaps and permit disjoint edits in either API order',async()=>{
 for(const exact of [false,true])for(const continuousFirst of [false,true]){
  await reset();const shape=exact?{rangeStart:2,rangeEnd:5}:{spanOcc:0};
  const input={anchor,kind:'rewrite',quote:'cat',baseText:text,body:'CAT',...shape};
  if(continuousFirst){const x=(await save((await get()).data,'A CAT and a dog.')).data.snapshot.records[0];const denied=await b('POST','/api/suggest/fixture',input);assert.equal(denied.status,409);assert.equal(denied.data.existingId,x.id);
   const safe=await b('POST','/api/suggest/fixture',{...input,quote:'dog',...(exact?{rangeStart:12,rangeEnd:15}:{}),body:'DOG'});assert.equal(safe.status,200);
  }else{const x=await b('POST','/api/suggest/fixture',input);assert.equal(x.status,200);const denied=await save((await get()).data,'A CAT and a dog.');assert.equal(denied.status,409);assert.equal(denied.data.existingId,x.data.suggestion.id);assert.equal((await save((await get()).data,'A cat and a DOG.')).status,200)}
 }
});
await test('paragraph epochs ignore unrelated activity but reject same-paragraph ABA across reopen',async()=>{
 await reset();const initial=(await get()).data;
 // Same document, different occurrence: legacy writer, reply and status cycle.
 const note=await b('POST','/api/suggest/fixture',{anchor:anchor+'#1',kind:'comment',body:'Elsewhere'});assert.equal(note.status,200);
 assert.equal((await b('POST',`/api/suggest/fixture/${note.data.suggestion.id}/replies`,{body:'Elsewhere reply'})).status,200);
 db.prepare("UPDATE suggestions SET status='resolved' WHERE id=?").run(note.data.suggestion.id);
 assert.equal((await get()).data.version,initial.version);
 await writeFile(path.join(dir,'other.html'),original);
 assert.equal((await b('POST','/api/suggest/other',{anchor,kind:'comment',body:'Other document'})).status,200);
 assert.equal((await get()).data.version,initial.version);
 await stop();db.close();db=openDb(dbFile);await start();assert.equal((await get()).data.version,initial.version);
 const saved=await save(initial,'A CAT and a dog.');assert.equal(saved.status,200);
 const before=(await get()).data;
 const local=await b('POST','/api/suggest/fixture',{anchor,kind:'comment',body:'Here'});assert.equal(local.status,200);
 db.prepare('DELETE FROM suggestions WHERE id=?').run(local.data.suggestion.id);
 assert.notEqual((await get()).data.version,before.version);
 const denied=await save(before,'A CATS and a dog.');assert.equal(denied.status,409);assert.equal(denied.data.error,'revision_stale');
});
await test('successful upload A to B to A advances durable epoch without suggestions or overlays',async()=>{
 await reset();assert.equal((await owner('POST','/api/upload',{id:'fixture',html:original,overwrite:true})).status,200);
 const initial=(await get()).data,epoch=db.prepare('SELECT epoch FROM revision_epoch').get().epoch;
 assert.equal(db.prepare('SELECT count(*) n FROM suggestions').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM documents').get().n,0);
 assert.equal((await owner('POST','/api/upload',{id:'fixture',html:'<p>other source</p>',overwrite:true})).status,200);
 const middle=db.prepare('SELECT epoch FROM revision_epoch').get().epoch;assert.ok(middle>epoch);
 assert.equal((await owner('POST','/api/upload',{id:'fixture',html:original,overwrite:true})).status,200);
 const after=(await get()).data;assert.equal(after.sourceHash,initial.sourceHash);assert.notEqual(after.version,initial.version);assert.ok(db.prepare('SELECT epoch FROM revision_epoch').get().epoch>middle);
 await stop();db.close();db=openDb(dbFile);await start();assert.equal((await get()).data.version,after.version);
 assert.equal((await save(initial,'A CAT and a dog.')).status,409);
});
await test('document privacy deletion purges receipts/history/replies and reused IDs cannot replay historic success',async()=>{
 await reset();const p=payload((await get()).data,'A CAT and a dog.'),saved=await a('POST','/api/revision/fixture',p);assert.equal(saved.status,200);
 const id=saved.data.snapshot.records[0].id;assert.equal((await b('POST',`/api/suggest/fixture/${id}/replies`,{body:'private discussion'})).status,200);
 assert.ok(db.prepare("SELECT count(*) n FROM revision_receipts WHERE doc_id='fixture'").get().n>0);assert.ok(db.prepare("SELECT count(*) n FROM rewrite_history WHERE doc_id='fixture'").get().n>0);
 assert.equal((await owner('POST',`/api/suggest/fixture/${id}/accept`,{})).status,200);
 assert.ok(db.prepare("SELECT count(*) n FROM document_versions WHERE doc_id='fixture'").get().n>0);
 assert.equal((await owner('DELETE','/api/doc/fixture')).status,200);
 for(const table of ['documents','document_versions','suggestions','doc_owners','revision_receipts','rewrite_history','revision_purges'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table} WHERE doc_id='fixture'`).get().n,0,table);
 assert.equal(db.prepare('SELECT count(*) n FROM suggestion_replies').get().n,0);
 assert.equal((await a('POST','/api/revision/fixture',p)).status,404);
 assert.equal((await owner('POST','/api/upload',{id:'fixture',html:original})).status,200);
 const replay=await a('POST','/api/revision/fixture',p);assert.equal(replay.status,409);assert.equal(replay.data.error,'revision_stale');
 assert.equal(db.prepare("SELECT count(*) n FROM revision_receipts WHERE doc_id='fixture'").get().n,0);
 assert.equal(db.prepare("SELECT count(*) n FROM rewrite_history WHERE doc_id='fixture'").get().n,0);
});
}finally{if(server?.listening)await stop();db.close();await rm(dir,{recursive:true,force:true})}
