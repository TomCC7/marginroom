// Local disposable HTTP + Chromium acceptance. Never contacts an existing service.
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openDb, setDocAccess} from '../db.js';
import {machineAuth, digest} from '../machine-auth.js';
import {launchBrowser} from './helpers/browser.mjs';
const root=await mkdtemp(path.join(process.env.TMPDIR,'inherited-resolve-'));
const out=process.env.RESOLVE_ARTIFACTS||root;await mkdir(out,{recursive:true});
process.env.HS_DOCS_DIR=root;process.env.OWNER_KEY='resolve-fixture-owner';process.env.SESSION_SECRET='resolve-fixture-secret';process.env.MMW_WRITE_PER_MIN='10000';process.env.MMW_READ_PER_MIN='10000';
const binary=process.env.TEST_BINARY;let db,machine,server,origin,service;
if(binary){
 await mkdir(root+'/home');await writeFile(root+'/seed.html','<html><body><p>Isolated service seed.</p></body></html>');
 await promisify(execFile)(binary,['open',root+'/seed.html','--data-dir',root+'/state','--json'],{env:{...process.env,HOME:root+'/home'}});
 service=JSON.parse(await readFile(root+'/state/service.json'));origin=service.origin;machine=JSON.parse(await readFile(root+'/state/credentials.json'));db=openDb(root+'/state/app.db');
}else{
 db=openDb(root+'/test.db');machine=machineAuth(db).issue();
 const {createApp}=await import('../server.js');server=await new Promise(resolve=>{const s=createApp(db).listen(0,'127.0.0.1',()=>resolve(s))});origin='http://127.0.0.1:'+server.address().port;
}
const docsRoot=binary?root+'/state/documents':root;
let browser;const checks=[];const pass=s=>{checks.push(s);console.log('PASS '+s)};
async function api(route,body,token=machine.token){const r=await fetch(origin+route,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
async function version(html,previous){const bytes=Buffer.from(html),r=await api('/api/imports',{entry:'index.html',source:'resolve-fixture',previous,files:[{path:'index.html',data:bytes.toString('base64'),sha256:digest(bytes)}]});assert.equal(r.status,200,JSON.stringify(r));return r.data.document}
async function claim(context,doc){const r=await api('/api/management/handoff',{doc});assert.equal(r.status,200);assert.equal((await context.request.post(origin+'/api/management/claim',{data:{token:r.data.token}})).status(),200)}
const text='Exact unchanged passage.',html='<html><body><h1>Resolve fixture</h1><p id="exact">'+text+'</p><canvas id="banner">Historical banner</canvas><input id="retained" value="initial"><script>document.body.dataset.boot="ready"</script></body></html>';
try{
 const v1=await version(html),v2=await version(html.replace('<canvas id="banner">Historical banner</canvas>','<p>New version without canvas.</p>'),v1),v3=await version(html.replace('<canvas id="banner">Historical banner</canvas>','<p>Third version without canvas.</p>'),v2);
 browser=await launchBrowser();const reviewer=await browser.newContext();
 const make=async(body,kind='comment')=>{const r=await reviewer.request.post(origin+'/api/suggest/'+v1,{data:{anchor:digest(text),quote:'unchanged',baseText:text,rangeStart:6,rangeEnd:15,body,kind}});assert.equal(r.status(),200);return (await r.json()).suggestion};
 const exact=await make('EXACT ORIGINAL BODY'),rewrite=await make('PROPOSED REWRITE','rewrite');
 assert.equal((await reviewer.request.post(origin+`/api/suggest/${v1}/${exact.id}/reject`,{data:{}})).status(),403);
 const entitled=await browser.newContext({viewport:{width:1280,height:900}});await claim(entitled,v1);
 const sourcePage=await entitled.newPage();await sourcePage.goto(origin+'/viewer.html?doc='+v1);await sourcePage.waitForSelector('#thread-'+exact.id);
 const sourceFrame=sourcePage.frames().find(f=>f!==sourcePage.mainFrame());await sourceFrame.waitForSelector('#banner');await sourcePage.locator('.topbar [data-mode="suggest"]').click();await sourceFrame.locator('#banner').click();await sourcePage.waitForFunction(()=>document.querySelector('#target-label')?.textContent.includes('#banner'));
 await sourcePage.locator('#selection-action').click();await sourcePage.locator('#comment-body').fill('CANVAS ORIGINAL BODY');await sourcePage.locator('#send-comment').click();await sourcePage.waitForFunction(()=>document.querySelector('#composer').hidden);
 const stale=db.prepare('SELECT * FROM suggestions WHERE body=?').get('CANVAS ORIGINAL BODY');assert.match(stale.anchor,/^c3:[a-f0-9]{64}:self$/);await sourcePage.close();
 await api(`/api/suggest/${v1}/${exact.id}/replies`,{body:'ORIGINAL REPLY'},null);await api(`/api/suggest/${v1}/${stale.id}/replies`,{body:'CANVAS REPLY'},null);
 const original=db.prepare('SELECT * FROM suggestions ORDER BY id').all(),replies=db.prepare('SELECT * FROM suggestion_replies ORDER BY id').all();
 const sources=new Map(await Promise.all([v1,v2,v3].map(async id=>[id,await readFile(docsRoot+'/'+id+'.html','utf8')])));
 const page=await entitled.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/viewer.html?doc='+v3);await page.waitForSelector('#thread-'+stale.id);
 assert.equal((await (await entitled.request.get(origin+'/api/doc/'+v3)).json()).isDocOwner,false);
 if(process.env.REPRO){assert.equal(await page.locator('#thread-'+stale.id+' [data-resolve]').count(),0);assert.equal(await page.locator('#thread-'+exact.id+' [data-resolve]').count(),0);pass('BASELINE reproduced: source-entitled human sees no Resolve on outdated canvas or located inherited comment');}
 else{
 const records=async(context,doc=v3)=>(await (await context.request.get(origin+'/api/suggestions/'+doc+'?status=all')).json()).suggestions;
 const counts=async(p,n)=>assert.deepEqual(await p.locator('.total').allTextContents(),Array(await p.locator('.total').count()).fill(String(n)));
 await counts(page,original.length);
 let rows=await records(entitled);assert.equal(rows.find(r=>r.id===exact.id).placement.status,'located');assert.notEqual(rows.find(r=>r.id===stale.id).placement.status,'located');assert.equal(rows.find(r=>r.id===stale.id).canResolveComment,true);
 assert.equal(await page.locator('#thread-'+rewrite.id+' [data-accept],#thread-'+rewrite.id+' [data-stale-resolve],#thread-'+rewrite.id+' [data-resolve]').count(),0);
 await page.locator('[data-filter="all"]').click();
 const frame=page.frames().find(f=>f!==page.mainFrame());await frame.waitForSelector('#retained');await frame.locator('#retained').fill('KEEP APPLICATION STATE');
 const input=await frame.locator('#retained').elementHandle(),iframe=await page.locator('iframe').first().elementHandle();
 // Failed HTTP write must not optimistically move a pending thread.
 const endpoint=`**/api/suggest/${v1}/${stale.id}/reject`;await page.route(endpoint,r=>r.fulfill({status:503,json:{error:'synthetic_failure'}}));
 await page.locator('#thread-'+stale.id+' [data-resolve]').click();await page.waitForFunction(()=>document.querySelector('#hs-status')?.textContent.includes('synthetic_failure'));
 assert.equal(db.prepare('SELECT status FROM suggestions WHERE id=?').get(stale.id).status,'open');assert.equal(await page.locator('#thread-'+stale.id+' [data-resolve]').isEnabled(),true);await page.unroute(endpoint);
 pass('failed request retains Pending and re-enables Resolve');
 const requests=[];page.on('request',r=>{if(r.method()==='POST')requests.push(new URL(r.url()).pathname)});
 await page.locator('#thread-'+stale.id+' [data-resolve]').click();await page.waitForSelector('#thread-'+stale.id+' [data-reopen]');
 assert.equal(requests.at(-1),`/api/suggest/${v1}/${stale.id}/reject`);assert.equal(db.prepare('SELECT status FROM suggestions WHERE id=?').get(stale.id).status,'rejected');await counts(page,original.length-1);assert.match(await page.locator('#list-'+stale.id+' .status').textContent(),/resolved/i);
 assert.equal(await iframe.evaluate(n=>n.isConnected),true);assert.equal(await input.evaluate(n=>n.isConnected&&n.value),'KEEP APPLICATION STATE');
 assert.equal(await page.locator('#thread-'+stale.id+' .history-source').count(),1);assert.match(await page.locator('#thread-'+stale.id+' .thread-replies').textContent(),/CANVAS REPLY/);
 await page.locator('#discussion-list-toggle').click();await page.locator('[data-status="done"]').click();await page.locator('#list-'+stale.id+' [data-list-reopen]').click();await page.waitForSelector('#list-'+stale.id,{state:'detached'});await counts(page,original.length);
 await page.locator('[data-status="all"]').click();await page.locator('#discussion-thread-toggle').click();await page.locator('#thread-'+stale.id+' [data-resolve]').click();await page.waitForSelector('#thread-'+stale.id+' [data-reopen]');
 // Same authoritative thread updates in source, intermediate and latest versions.
 for(const doc of [v1,v2,v3]){assert.equal((await records(entitled,doc)).find(r=>r.id===stale.id).status,'rejected');const pending=await entitled.request.get(origin+'/api/suggestions/'+doc+'?status=open');assert(!(await pending.json()).suggestions.some(r=>r.id===stale.id));}
 await page.locator('[data-filter="open"]').click();assert.equal(await page.locator('#thread-'+stale.id).count(),0);await page.locator('[data-filter="done"]').click();await page.waitForSelector('#thread-'+stale.id);await page.locator('#thread-'+stale.id+' [data-reopen]').click();await page.locator('[data-filter="open"]').click();await page.waitForSelector('#thread-'+stale.id);
 await page.locator('#thread-'+exact.id+' [data-resolve]').click();await page.waitForFunction(id=>document.querySelector('#thread-'+CSS.escape(id))===null,exact.id);
 await page.reload();await page.waitForSelector('#thread-'+stale.id);rows=await records(entitled);assert.equal(rows.find(r=>r.id===exact.id).status,'rejected');
 pass('actual Resolve/Reopen on descendant routes to source ID; source/intermediate/latest filters and reload agree; no source iframe replacement');
 // Refresh another already-open version through the existing polling path.
 const other=await entitled.newPage();await other.goto(origin+'/viewer.html?doc='+v2);await other.waitForSelector('#thread-'+stale.id+' [data-resolve]');await other.locator('[data-filter="all"]').click();
 await page.locator('#thread-'+stale.id+' [data-resolve]').click();await other.waitForSelector('#thread-'+stale.id+' [data-reopen]',{timeout:20000});await counts(other,original.length-2);await other.close();pass('already-open intermediate version refreshes authoritative status');
 // Source entitlement, never current-doc ownership, controls lifecycle.
 const descendantOwner=await browser.newContext();await claim(descendantOwner,v3);const denied=await descendantOwner.newPage();await denied.goto(origin+'/viewer.html?doc='+v3);await denied.waitForSelector('#thread-'+rewrite.id);await denied.locator('[data-filter="all"]').click();await denied.waitForSelector('#thread-'+stale.id);
 assert.equal((await records(descendantOwner)).find(r=>r.id===stale.id).canResolveComment,false);assert.equal(await denied.locator('#thread-'+stale.id+' [data-reopen]').count(),0);assert.match(await denied.locator('#thread-'+stale.id).textContent(),/source.*management|原始.*管理/);
 for(const action of ['reject','reopen'])assert.equal((await descendantOwner.request.post(origin+`/api/suggest/${v1}/${stale.id}/${action}`,{data:{}})).status(),403);
 const guest=reviewer,guestPage=await guest.newPage();await guestPage.goto(origin+'/viewer.html?doc='+v3);await guestPage.waitForSelector('#thread-'+rewrite.id);await guestPage.locator('[data-filter="all"]').click();await guestPage.waitForSelector('#thread-'+stale.id);assert.equal(await guestPage.locator('#thread-'+exact.id+' [data-reopen]').count(),0);assert.equal((await guest.request.post(origin+`/api/suggest/${v1}/${exact.id}/reopen`,{data:{}})).status(),403);
 // Machine uploads/grants don't grant native resolve access; bearer middleware remains the boundary.
 assert.equal((await api(`/api/suggest/${v1}/${stale.id}/reopen`,{})).status,403);assert.equal((await api('/api/suggestions/'+v3+'?status=all')).data.suggestions.find(r=>r.id===stale.id).canResolveComment,false);
 const scoped=(await api('/api/machine/delegate',{doc:v3})).data;assert.equal((await api(`/api/suggest/${v1}/${stale.id}/reopen`,{},scoped.token)).status,403);assert.equal((await api('/api/suggestions/'+v1,null,scoped.token)).status,403);
 // Wrong current-doc route is rejected even when current document is managed.
 assert.equal((await entitled.request.post(origin+`/api/suggest/${v3}/${stale.id}/reopen`,{data:{}})).status(),403);await claim(entitled,v3);assert.equal((await entitled.request.post(origin+`/api/suggest/${v3}/${stale.id}/reopen`,{data:{}})).status(),404);
 setDocAccess(db,v1,'view');assert(!(await records(guest)).some(r=>r.id===stale.id));assert.equal((await guest.request.post(origin+`/api/suggest/${v1}/${stale.id}/reopen`,{data:{}})).status(),403);setDocAccess(db,v1,'suggest');
 // Revoke a live human source grant after button rendering: server denial keeps pending.
 await page.reload();await page.waitForSelector('#thread-'+rewrite.id);await page.locator('[data-filter="all"]').click();await page.waitForSelector('#thread-'+stale.id+' [data-reopen]');await page.locator('#thread-'+stale.id+' [data-reopen]').click();await page.waitForSelector('#thread-'+stale.id+' [data-resolve]');
 const grant=db.prepare('SELECT * FROM document_grants WHERE doc=? AND principal NOT LIKE ?').get(v1,'m_%');assert(grant);db.prepare('DELETE FROM document_grants WHERE doc=? AND principal=?').run(v1,grant.principal);
 await page.locator('#thread-'+stale.id+' [data-resolve]').click();await page.waitForFunction(()=>document.querySelector('#hs-status')?.className.includes('error')||document.querySelector('#hs-status')?.textContent.includes('not_your_doc'));assert.equal(db.prepare('SELECT status FROM suggestions WHERE id=?').get(stale.id).status,'open');await claim(entitled,v1);
 pass('browser/server negatives: guest, current-only owner, read-only link/scope, machine, wrong doc and revoked human grant; denied write stays pending');
 await page.reload();await page.waitForSelector('#thread-'+stale.id+' [data-resolve]');await page.locator('[data-filter="all"]').click();
 for(const width of [1120,390,360]){await page.setViewportSize({width,height:844});await page.waitForTimeout(200);if(width<=1100&&!await page.locator('#threads').isVisible())await page.locator('.comment-toggle').click();await page.locator('#thread-'+stale.id+' [data-resolve]').scrollIntoViewIfNeeded();await page.screenshot({path:out+`/resolve-${width}.png`});const box=await page.locator('#thread-'+stale.id+' [data-resolve]').boundingBox();assert(box&&box.x>=0&&box.x+box.width<=width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)}
 // Native mobile click, not DOM dispatch.
 await page.locator('#thread-'+stale.id+' [data-resolve]').click();await page.waitForSelector('#thread-'+stale.id+' [data-reopen]');
 pass('narrow desktop and 390/360 phone sidebar action fits; real mobile-size Resolve click succeeds');
 for(const row of original){const actual=db.prepare('SELECT * FROM suggestions WHERE id=?').get(row.id);assert.deepEqual({...actual,status:row.status},row)}assert.deepEqual(db.prepare('SELECT * FROM suggestion_replies ORDER BY id').all(),replies);for(const [id,source]of sources)assert.equal(await readFile(docsRoot+'/'+id+'.html','utf8'),source);assert.equal(db.prepare("SELECT count(*) n FROM documents WHERE overlay_json!='{}'").get().n,0);assert.deepEqual(errors,[]);
 pass('original IDs/locators/body/author/replies and all source HTML unchanged; no rewrite overlay or browser errors');
 }
 await writeFile(out+'/receipt.json',JSON.stringify({checks,root,binary:binary||'source Bun',baseline:process.env.REPRO?'1a8030d':undefined},null,2));console.log('ARTIFACT_ROOT '+out);
}finally{
 await browser?.close();
 if(server)await new Promise(r=>server.close(r));
 if(service){
  assert.equal((await (await fetch(origin+'/api/instance')).json()).instanceId,service.instanceId);
  assert((await readFile(`/proc/${service.pid}/cmdline`,'utf8')).includes(binary+'\0--service\0'+root+'/state'));
  process.kill(service.pid,'SIGTERM');
  for(let i=0;i<100;i++){try{await fetch(origin+'/api/instance');await new Promise(r=>setTimeout(r,25))}catch{break}}
 }
 db.close();
}
