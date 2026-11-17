// Actual disposable Bun app + opaque iframe browser. Optional installed executable.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openDb,addSuggestion,setDocAccess} from '../db.js';
import {machineAuth,digest} from '../machine-auth.js';
import {launchBrowser} from './helpers/browser.mjs';
const exec=promisify(execFile),root=await mkdtemp(path.join(process.env.TMPDIR,'version-feedback-')),out=process.env.VERSION_ARTIFACTS||root;
await mkdir(out,{recursive:true});
process.env.HS_DOCS_DIR=root;process.env.OWNER_KEY='version-fixture-owner';process.env.SESSION_SECRET='version-fixture-secret';process.env.MMW_WRITE_PER_MIN='10000';process.env.MMW_READ_PER_MIN='10000';
let db,credential,server,origin,browser,service;
const binary=process.env.TEST_BINARY;
const cli=async(args,json=true)=>{const r=await exec(binary||process.execPath,[...(binary?[]:['bin/marginroom.mjs']),...args,'--data-dir',root+'/state',...(json?['--json']:[])],{env:{...process.env,HOME:root+'/home'}});return json?JSON.parse(r.stdout):r.stdout;};
async function start(){if(binary){await mkdir(root+'/home',{recursive:true});await writeFile(root+'/seed.html','<html><body><p>Seed fixture</p></body></html>');await cli(['open',root+'/seed.html']);service=JSON.parse(await readFile(root+'/state/service.json'));origin=service.origin;credential=JSON.parse(await readFile(root+'/state/credentials.json'));db=openDb(root+'/state/app.db');}else{db=openDb(root+'/test.db');credential=machineAuth(db).issue();const {createApp}=await import('../server.js');server=await new Promise(resolve=>{const s=createApp(db).listen(0,'127.0.0.1',()=>resolve(s))});origin='http://127.0.0.1:'+server.address().port;}}
async function stop(){if(binary){const cmd=await readFile(`/proc/${service.pid}/cmdline`,'utf8').catch(()=>null);if(cmd){assert(cmd.includes(binary+'\0--service\0'+root+'/state'));assert.equal((await (await fetch(origin+'/api/instance')).json()).instanceId,service.instanceId);process.kill(service.pid,'SIGTERM');for(let i=0;i<100;i++){try{await fetch(origin+'/api/instance');await new Promise(r=>setTimeout(r,25));}catch{break;}}}}else await new Promise(r=>server.close(r));db.close();}
const api=async(route,body,token=credential.token,method=body?'POST':'GET')=>{const r=await fetch(origin+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}};
const html='<html><head><title>Version history fixture</title></head><body><h1>Version history</h1><p id="unchanged">Exact 😀 unchanged passage.</p><p id="changed">Changed passage.</p><p id="deleted">Deleted passage.</p><p id="duplicate">Duplicate quote.</p><p id="math">Before <span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi><annotation>x</annotation></semantics></math></span><span class="katex-html">x</span></span> 😀 after math.</p><script>document.body.dataset.boot="ready";</script></body></html>';
async function version(text,previous,source='fixture'){const b=Buffer.from(text);const r=await api('/api/imports',{entry:'index.html',source,previous,files:[{path:'index.html',data:b.toString('base64'),sha256:digest(b)}]});assert.equal(r.status,200,JSON.stringify(r));return r.data;}
const rows=id=>db.prepare('SELECT * FROM suggestions WHERE doc_id=? ORDER BY id').all(id);
const checks=[];function pass(s){checks.push(s);console.log('PASS '+s);}
try{
 await start();const v1=(await version(html)).document;
 const comment=async(doc,text,quote,body,kind='comment')=>{const r=await api('/api/suggest/'+doc,{anchor:digest(text),baseText:text,quote,body,kind,rangeStart:text.indexOf(quote),rangeEnd:text.indexOf(quote)+quote.length},null);assert.equal(r.status,200,JSON.stringify(r));return r.data.suggestion;};
 const old=await comment(v1,'Exact 😀 unchanged passage.','unchanged','ANCESTOR FULL BODY');
 assert.equal((await api(`/api/suggest/${v1}/${old.id}/replies`,{body:'ORIGINAL REPLY'},null)).status,200);
 const changed=await comment(v1,'Changed passage.','Changed','CHANGED BODY'),deleted=await comment(v1,'Deleted passage.','Deleted','DELETED BODY'),duplicate=await comment(v1,'Duplicate quote.','Duplicate','DUPLICATE BODY');
 const pending=await comment(v1,'Exact 😀 unchanged passage.','Exact','Proposed rewrite','rewrite');
 const resolved=await comment(v1,'Changed passage.','passage','RESOLVED BODY');
 const managed=machineAuth(db).issue();db.prepare('INSERT OR IGNORE INTO document_grants VALUES(?,?)').run(v1,managed.principal);
 assert.equal((await api(`/api/suggest/${v1}/${resolved.id}/reject`,{},managed.token)).status,403); // machine mutation routes stay denied
 // A real human owner receives only the existing per-doc management handoff.
 browser=await launchBrowser();const owner=await browser.newContext(),page=await owner.newPage();
 const claim=(await api('/api/management/handoff',{doc:v1})).data;
 await page.goto(origin+'/claim.html#'+claim.token);await page.waitForURL('**/viewer.html?doc='+v1);await page.waitForTimeout(800);
 assert.equal((await owner.request.post(origin+`/api/suggest/${v1}/${resolved.id}/reject`,{data:{}})).status(),200);
 // Native c3 range in an actual opaque allow-scripts iframe.
 const frame=page.frames().find(f=>f!==page.mainFrame());assert(frame);assert.equal(await frame.evaluate(()=>location.origin),'null');assert.equal(await page.locator('iframe').first().getAttribute('sandbox'),'allow-scripts');
 await page.locator('.topbar [data-mode="suggest"]').click();
 await frame.locator('#unchanged').click({clickCount:3});await page.waitForTimeout(200);await page.locator('#selection-action').click();await page.locator('#comment-body').fill('NATIVE C3 BODY');await page.locator('#send-comment').click();await page.waitForFunction(()=>document.querySelector('#composer').hidden);
 const c3=rows(v1).find(r=>r.body==='NATIVE C3 BODY');assert.match(c3.anchor,/^c3:/);
 // Persist an actual old raw KaTeX/UTF16 coordinate fixture, preserving its original fields.
 await frame.locator('#math').click({clickCount:3});await page.waitForTimeout(200);await page.locator('#selection-action').click();await page.locator('#comment-body').fill('MATH BODY');await page.locator('#send-comment').click();await page.waitForFunction(()=>document.querySelector('#composer').hidden);
 const math=rows(v1).find(r=>r.body==='MATH BODY');assert.match(math.anchor,/^c3:/);const raw='Before xxx 😀 after math.',quote='😀 after';
 db.prepare('UPDATE suggestions SET base_text=?,quote=?,range_start=?,range_end=? WHERE id=?').run(raw,quote,raw.indexOf(quote),raw.indexOf(quote)+quote.length,math.id);
 const oldRows=rows(v1),oldReplies=db.prepare('SELECT * FROM suggestion_replies ORDER BY id').all();
 const html2=html.replace('Changed passage.','Revised passage.').replace('<p id="deleted">Deleted passage.</p>','').replace('</body>','<p>Added in v2.</p></body>');const v2=(await version(html2,v1)).document;
 const series=await api('/api/document-series/'+v2,null,null),feedback=await api('/api/suggestions/'+v2+'?status=all',null,null);
 if(process.env.REPRO){assert.equal(series.status,403);assert.equal(feedback.data.suggestions.length,0);pass('PRE-FIX guest series 403 and new-version feedback empty despite ancestor body/replies');}
 else{
 assert.equal(series.status,200);assert.deepEqual(series.data.versions.map(v=>v.doc),[v1,v2]);
 assert.equal(feedback.data.suggestions.find(r=>r.id===old.id).replies[0].body,'ORIGINAL REPLY');
 const html3=html2.replace('</body>','<p>Duplicate quote.</p><p>Added in v3.</p></body>');const v3=(await version(html3,v2)).document;
 const fork=(await version(html.replace('</body>','<p>Fork only.</p></body>'),v1,'fork')).document,unrelated=(await version('<html><body><p>Unrelated.</p></body></html>',null,'unrelated')).document;
 const native=await comment(v3,'Added in v3.','Added','CURRENT NATIVE BODY');await comment(fork,'Fork only.','Fork','SECRET SIBLING BODY');await comment(unrelated,'Unrelated.','Unrelated','UNRELATED BODY');
 let data=(await api('/api/suggestions/'+v3+'?status=all',null,null)).data;
 assert.equal(data.complete,true);assert.equal(new Set(data.suggestions.map(r=>r.id)).size,data.suggestions.length);assert.equal(data.suggestions.length,oldRows.length+1);
 const inherited=data.suggestions.find(r=>r.id===old.id);assert.equal(inherited.sourceDocId,v1);assert.equal(inherited.doc_id,v1);assert.equal(inherited.placement.status,'located');assert.equal(inherited.placement.start,9);assert.equal(inherited.placement.end,18);
 assert.equal(data.suggestions.find(r=>r.id===native.id).inherited,undefined);
 assert.equal(data.suggestions.find(r=>r.id===changed.id).placement.status,'not_found');assert.equal(data.suggestions.find(r=>r.id===deleted.id).placement.status,'not_found');assert.equal(data.suggestions.find(r=>r.id===duplicate.id).placement.status,'ambiguous');
 assert.equal(data.suggestions.find(r=>r.id===c3.id).placement.status,'located');const mathProjection=data.suggestions.find(r=>r.id===math.id);assert.equal(mathProjection.placement.status,'located');assert.equal(mathProjection.placement.baseText.slice(mathProjection.placement.start,mathProjection.placement.end),quote);assert.equal(mathProjection.base_text,raw);
 assert.equal(data.suggestions.find(r=>r.id===pending.id).status,'open');
 assert.deepEqual(rows(v1),oldRows);assert.deepEqual(db.prepare('SELECT * FROM suggestion_replies ORDER BY id').all(),oldReplies);
 assert.deepEqual((await api('/api/document-series/'+v3,null,null)).data.versions.map(v=>v.doc),[v1,v2,v3]);assert.equal((await api('/api/versions-locate',{record:native.id,target:v2},null)).status,400);
 assert.equal((await api('/api/suggestions/'+v3+'?status=rejected',null,null)).data.suggestions[0].id,resolved.id);
 assert(!(await api('/api/suggestions/'+v3+'?status=open',null,null)).data.suggestions.some(r=>r.id===resolved.id));
 pass('v1→v2→v3 native+all ancestors once; siblings/descendants/unrelated excluded; BODY/replies/provenance, statuses and immutable original rows');
 // Ordinary guest: no owner handoff, no machine credentials.
 const guest=await browser.newContext({viewport:{width:1440,height:900}}),review=await guest.newPage(),errors=[];review.on('pageerror',e=>errors.push(e.message));
 await review.goto(origin+'/viewer.html?doc='+v3);await review.waitForSelector('#thread-'+old.id);await review.waitForTimeout(600);
 assert.equal((await (await guest.request.get(origin+'/api/doc/'+v3)).json()).isDocOwner,false);
 assert.equal(await review.locator('#thread-'+old.id+' .thread-summary').textContent(),'ANCESTOR FULL BODY');assert.match(await review.locator('#thread-'+old.id+' .thread-replies').textContent(),/ORIGINAL REPLY/);
 assert.equal(await review.locator('#thread-'+pending.id+' [data-accept]').count(),0);
 assert.match(await review.locator('#thread-'+changed.id).textContent(),/historical|历史/);
 assert.equal(await review.locator('#thread-'+changed.id+' [data-locate]').count(),0);
 assert.equal(await review.locator('#thread-'+changed.id+' .history-source a').getAttribute('href'),'/viewer.html?doc='+v1);
 const liveFrame=review.frames().find(f=>f!==review.mainFrame());
 await review.locator('#thread-'+old.id+' [data-locate]').click();await liveFrame.waitForSelector(`[data-thread="${old.id}"]`);assert.equal(await liveFrame.locator(`[data-thread="${old.id}"]`).textContent(),'unchanged');
 await liveFrame.waitForSelector(`[data-thread="${math.id}"]`);assert.equal(await liveFrame.locator(`[data-thread="${math.id}"]`).textContent(),quote);
 assert.equal(await liveFrame.locator('[data-review-ins]').count(),0);assert.equal(await liveFrame.locator(`[data-thread="${changed.id}"]`).count(),0);
 await review.screenshot({path:out+'/history-1440.png'});await review.setViewportSize({width:390,height:844});await review.waitForTimeout(300);await review.locator('.comment-toggle').click();await review.waitForTimeout(200);await review.screenshot({path:out+'/history-390.png'});
 await review.locator('#thread-'+old.id+' [data-reply]').click();await review.locator('#comment-body').fill('LATE REPLY FROM V3');await review.locator('#send-comment').click();await review.waitForFunction(()=>document.querySelector('#composer').hidden);
 const late=(await api('/api/suggestions/'+v1+'?status=all')).data.suggestions.find(r=>r.id===old.id);assert.equal(late.replies.at(-1).body,'LATE REPLY FROM V3');assert.equal(db.prepare('SELECT count(*) n FROM suggestions WHERE id=?').get(old.id).n,1);
 assert.equal((await api(`/api/suggest/${v3}/${old.id}/accept`,{},null)).status,403);
 await review.reload();await review.waitForSelector('#thread-'+old.id,{state:'attached'});assert.match(await review.locator('#thread-'+old.id+' .thread-replies').textContent(),/LATE REPLY FROM V3/);
 assert.deepEqual(rows(v1),oldRows);assert.deepEqual(errors,[]);
 pass('ordinary guest opaque iframe right Discussion full body/replies; exact legacy/c3/math Locate; outdated no highlight; source link; reply routes to source; reload and desktop/phone screenshots');
 // Narrow read grants cannot inherit the owner's other documents, even public ones.
 const scoped=(await api('/api/machine/delegate',{doc:v3})).data;
 assert.deepEqual((await api('/api/suggestions/'+v3+'?status=all',null,scoped.token)).data.suggestions.map(r=>r.id),[native.id]);
 assert.equal((await api('/api/suggestions/'+v1,null,scoped.token)).status,403);assert.equal((await api('/api/document-series/'+v3,null,scoped.token)).status,403);
 await api('/api/machine/revoke',{token:scoped.token});assert.equal((await api('/api/suggestions/'+v3,null,scoped.token)).status,401);assert.equal((await api('/api/suggestions/'+v3,null,'A'.repeat(43))).status,401);
 assert.equal((await guest.request.put(origin+'/api/access/'+v3,{data:{level:'edit'}})).status(),403);assert.equal((await guest.request.delete(origin+'/api/doc/'+v3)).status(),403);
 setDocAccess(db,v2,'view');assert.deepEqual((await api('/api/document-series/'+v3,null,null)).data.versions.map(v=>v.doc),[v3]);assert.deepEqual((await api('/api/suggestions/'+v3+'?status=all',null,null)).data.suggestions.map(r=>r.id),[native.id]);
 assert.equal((await api('/api/versions-locate',{record:old.id,target:v3},null)).status,400);
 assert.equal((await api('/api/suggestions/'+v3+'?status=all')).data.suggestions.length,oldRows.length+1);setDocAccess(db,v2,'suggest');
 pass('per-ancestor authorization barrier, private predecessor metadata/body hidden; owner retains chain; narrow/revoked/invalid token negatives and guest management denial');
 // A thread written on the original after v3 creation appears without copying.
 const lateThread=await comment(v1,'Exact 😀 unchanged passage.','Exact','THREAD CREATED AFTER V3');assert((await api('/api/suggestions/'+v3+'?status=all',null,null)).data.suggestions.some(r=>r.id===lateThread.id));
 const p1=(await api('/api/suggestions/'+v3+'?status=all&limit=2',null,null)).data;assert.equal(p1.complete,false);assert.equal(p1.nextOffset,2);
 const p2=(await api('/api/suggestions/'+v3+'?status=all&limit=2&offset=2&snapshot='+p1.snapshot,null,null)).data;assert.equal(p2.suggestions.length,2);assert(!p1.suggestions.some(x=>p2.suggestions.some(y=>x.id===y.id)));
 await api(`/api/suggest/${v1}/${old.id}/replies`,{body:'After pagination'},null);assert.equal((await api('/api/suggestions/'+v3+'?status=all&offset=2&snapshot='+p1.snapshot,null,null)).status,409);
 assert.equal((await api('/api/suggestions/'+v3+'?limit=201',null,null)).status,400);
 assert.equal((await version(html3,v2)).document,v3);
 pass('post-descendant source thread/reply inheritance, bundle reuse, bounded pagination with fail-closed write invalidation');
 if(binary){
  const credentialFile=root+'/paired.json';await writeFile(credentialFile,JSON.stringify({...credential,origin,instanceId:service.instanceId}),{mode:0o600});
  const args=['comments',origin+'/viewer.html?doc='+v3,'--token-file',credentialFile,'--status','all'];const result=await cli(args);assert.equal(result.schemaVersion,1);assert.equal(result.complete,true);assert.equal(result.records.find(r=>r.id===old.id).replies.at(-1).body,'After pagination');assert.equal(result.records.find(r=>r.id===old.id).doc_id,v1);
  assert.match(await cli(args,false),/ANCESTOR FULL BODY/);assert.match(await cli(args,false),/Inherited from/);
  await stop();db=undefined;await cli(['open',root+'/seed.html']);service=JSON.parse(await readFile(root+'/state/service.json'));origin=service.origin;db=openDb(root+'/state/app.db');
  const restart=(await api('/api/suggestions/'+v3+'?status=all',null,null)).data;assert.equal(restart.suggestions.find(r=>r.id===math.id).placement.status,'located');assert.deepEqual(rows(v1),[...oldRows,db.prepare('SELECT * FROM suggestions WHERE id=?').get(lateThread.id)].sort((a,b)=>a.id.localeCompare(b.id)));
  await review.goto(origin+'/viewer.html?doc='+v3);await review.waitForSelector('#thread-'+math.id);const reopened=review.frames().find(f=>f!==review.mainFrame());await reopened.waitForSelector(`[data-thread="${math.id}"]`);assert.equal(await reopened.locator(`[data-thread="${math.id}"]`).textContent(),quote);
  pass('installed Linux compiled CLI JSON+human comments, authoritative source IDs/replies, real service restart persisted exact math attachment and unchanged old rows');
 }
 await guest.close();
 }
 await writeFile(out+'/version-receipt.json',JSON.stringify({checks,root,binary:binary||'source Bun',v1,v2,originalRows:oldRows.length},null,2));console.log('ARTIFACT_ROOT '+root);
}finally{await browser?.close();if(db)await stop();}
