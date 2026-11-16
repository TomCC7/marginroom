// Installed-artifact acceptance; all HTTP writes and screenshots are synthetic.
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,stat,symlink,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {launchBrowser} from './helpers/browser.mjs';
const exec=promisify(execFile),hash=b=>createHash('sha256').update(b).digest('hex');
const root=await mkdtemp(path.join(process.env.TMPDIR||os.tmpdir(),'marginroom-agent-')),data=path.join(root,'state'),fixture=path.join(root,'site'),prefix=path.join(root,'install'),out=process.env.AGENT_ARTIFACTS||root;
await mkdir(fixture);await mkdir(out,{recursive:true});let browser,ownedState;const checks=[];const check=(name)=>{checks.push(name);console.log('PASS '+name)};
async function stop(){if(!ownedState)return;const cmd=await readFile(`/proc/${ownedState.pid}/cmdline`,'utf8').catch(()=>null);if(!cmd)return;assert(cmd.includes(prefix+'/node_modules/marginroom/lib/cli/runner.mjs\0'+data));const info=await (await fetch(ownedState.origin+'/api/instance')).json();assert.equal(info.instanceId,ownedState.instanceId);process.kill(ownedState.pid,'SIGTERM');for(let i=0;i<100;i++){try{await fetch(ownedState.origin+'/api/instance');await new Promise(r=>setTimeout(r,30));}catch{return;}}throw Error('owned service did not stop');}
let occupied;
try{
 const packResult=JSON.parse((await exec('npm',['pack','--json','--pack-destination',root])).stdout);const packed=Array.isArray(packResult)?packResult[0]:Object.values(packResult)[0];const tarball=path.join(root,packed.filename);
 await exec('npm',['install','--prefix',prefix,tarball,'--omit=dev']);const cli=prefix+'/node_modules/.bin/marginroom';
 const call=async(args,exit=0)=>{let result;try{result=await exec(cli,[...args,'--data-dir',data,'--json']);assert.equal(exit,0,result.stdout);}catch(e){assert.equal(e.code,exit,e.stdout||e.message);result=e;}assert.equal(result.stderr,'');return JSON.parse(result.stdout);};
 const article='<html><head><title>Installed fixture</title><link rel="stylesheet" href="style.css"></head><body><p id="passage">Exact synthetic review passage.</p><img src="dot.svg"><script src="app.js"></script></body></html>';
 await writeFile(fixture+'/article.html',article);await writeFile(fixture+'/style.css','@import "nested.css"; p{color:rgb(12,34,56)}');await writeFile(fixture+'/nested.css','body {background:white}');await writeFile(fixture+'/app.js','document.body.dataset.boot="ready";');await writeFile(fixture+'/dot.svg','<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>');
 const before=hash(await readFile(fixture+'/article.html'));
 occupied=http.createServer((_req,res)=>res.end('unrelated'));await new Promise(r=>occupied.listen(0,'127.0.0.1',r));
 const [one,two]=await Promise.all([call(['open',fixture+'/article.html']),call(['open',fixture+'/article.html'])]);assert.equal(one.document,two.document);assert.equal(one.instanceId,two.instanceId);assert.equal((await fetch('http://127.0.0.1:'+occupied.address().port)).status,200);ownedState=JSON.parse(await readFile(data+'/service.json'));let origin=ownedState.origin;let creds=JSON.parse(await readFile(data+'/credentials.json'));
 const api=async(route,body,token=creds.token,expected=200)=>{const response=await fetch(origin+route,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result;};
 check('fresh tarball isolated install; actual executable concurrent open reuses one instance/document and unrelated port survives');
 for(const f of ['credentials.json','identity.json','service.json','app.db'])assert.equal((await stat(data+'/'+f)).mode&0o777,0o600);assert.equal((await stat(data)).mode&0o777,0o700);
 browser=await launchBrowser();const ctx=await browser.newContext({viewport:{width:1440,height:900}}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(one.reviewUrl);await page.waitForTimeout(1000);let frame=page.frames()[1];assert.equal(await frame.locator('body').getAttribute('data-boot'),'ready');assert.equal(await frame.locator('p').evaluate(el=>getComputedStyle(el).color),'rgb(12, 34, 56)');assert.equal(await frame.locator('img').evaluate(el=>el.naturalWidth),16);
 // Browser owns an earlier document using its existing cookie principal.
 const earlier=await ctx.request.post(origin+'/api/upload',{data:{id:'earlier-browser',html:'<p>Earlier browser-owned synthetic document</p>'}});assert.equal(earlier.status(),200);
 const cookieBefore=(await ctx.cookies()).find(c=>c.name==='mmw_guest').value;
 const handoff=await api('/api/management/handoff',{doc:one.document});await page.goto(origin+'/claim.html#'+handoff.token);await page.waitForURL('**/viewer.html?doc='+one.document);await page.waitForTimeout(800);assert.equal((await ctx.cookies()).find(c=>c.name==='mmw_guest').value,cookieBefore);assert((await (await ctx.request.get(origin+'/api/doc/'+one.document)).json()).isDocOwner);assert((await (await ctx.request.get(origin+'/api/doc/earlier-browser')).json()).isDocOwner);
 assert.equal((await ctx.request.post(origin+'/api/management/claim',{data:{token:handoff.token}})).status(),403);assert(!page.url().includes(handoff.token));
 const other=await browser.newContext();assert.equal((await (await other.request.get(origin+'/api/doc/'+one.document)).json()).isDocOwner,false);await other.close();
 check('private state 0600/0700; one-use handoff retains existing cookie and management of earlier browser document; plain link not management');
 frame=page.frames()[1];await page.locator('.topbar [data-mode="suggest"]').click();await frame.locator('#passage').click({clickCount:3});await page.waitForTimeout(250);await page.locator('#selection-action').click();await page.locator('#comment-body').fill('Installed synthetic exact feedback');await page.locator('#send-comment').click();await page.waitForFunction(()=>document.querySelector('#composer').hidden);
 let records=(await api('/api/suggestions/'+one.document+'?status=all')).suggestions;const record=records.find(r=>r.body==='Installed synthetic exact feedback');assert(record);assert.equal(record.quote,'Exact synthetic review passage.');assert.match(record.anchor,/^c3:[a-f0-9]{64}/);
 await page.locator(`[data-reply="${record.id}"]`).click();await page.locator('#comment-body').fill('Exact reply retained');await page.locator('#send-comment').click();await page.waitForFunction(()=>document.querySelector('#composer').hidden);
 const comments=await call(['comments',one.reviewUrl,'--status','open']);assert.equal(comments.records.find(r=>r.id===record.id).replies[0].body,'Exact reply retained');await page.reload();await page.waitForTimeout(800);assert(await page.locator('#thread-'+record.id).count());assert.equal(hash(await readFile(fixture+'/article.html')),before);
 await page.screenshot({path:out+'/agent-1440.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);await page.screenshot({path:out+'/agent-390.png',fullPage:true});await page.setViewportSize({width:1440,height:900});
 check('CSS import/JS/SVG runtime; native composer comment/reply exact ID/quote/context through CLI; reload and source bytes unchanged; 1440/390 captures');
 const readonly=await api('/api/machine/delegate',{doc:one.document});assert.equal((await api('/api/suggestions/'+one.document+'?status=all',null,readonly.token)).suggestions.length,1);
 await api('/api/imports',{},readonly.token,403);await api('/api/doc/earlier-browser',null,readonly.token,403);await api('/api/suggestions/'+one.document+'/reject',{},readonly.token,403);await api('/api/machine/revoke',{token:readonly.token});await api('/api/suggestions/'+one.document,null,readonly.token,401);await api('/api/doc/'+one.document,null,'A'.repeat(43),401);
 const pairFile=root+'/paired.json';await call(['pair','--out',pairFile]);const paired=await call(['open',fixture+'/article.html','--server',origin,'--token-file',pairFile]);assert.notEqual(paired.document,one.document);await api('/api/doc/'+one.document,null,JSON.parse(await readFile(pairFile)).token,403);
 check('document-scoped read token positive, cross-doc/write denial, revoked/invalid Bearer fail closed; real explicit pairing and remote import without service launch');
 const oldDoc=await api('/api/doc/'+one.document),oldRaw=await api('/api/raw/'+one.document),oldRows=await api('/api/suggestions/'+one.document+'?status=all');
 await writeFile(fixture+'/article.html',article.replace('</body>','<p>New paragraph.</p></body>'));assert.equal((await call(['open',fixture+'/article.html'],6)).error.code,'source_changed_use_new_version');
 const next=await call(['open',fixture+'/article.html','--new-version-of',one.reviewUrl]);assert.equal(next.series,one.series);assert.equal(next.previous,one.document);assert.equal((await api('/api/suggestions/'+next.document+'?status=all')).suggestions.length,0);
 assert.deepEqual(await api('/api/doc/'+one.document),oldDoc);assert.deepEqual(await api('/api/raw/'+one.document),oldRaw);assert.deepEqual(await api('/api/suggestions/'+one.document+'?status=all'),oldRows);
 let located=await api('/api/versions-locate',{record:record.id,target:next.document});assert.equal(located.status,'located');
 await writeFile(fixture+'/article.html',article.replace('</body>','<p>Exact synthetic review passage.</p></body>'));const duplicate=await call(['open',fixture+'/article.html','--new-version-of',next.reviewUrl]);assert.equal((await api('/api/versions-locate',{record:record.id,target:duplicate.document})).status,'ambiguous');
 await writeFile(fixture+'/article.html',article.replace('Exact synthetic review passage.','Removed original passage.'));const removed=await call(['open',fixture+'/article.html','--new-version-of',duplicate.reviewUrl]);assert.equal((await api('/api/versions-locate',{record:record.id,target:removed.document})).status,'not_found');
 const nextHandoff=await api('/api/management/handoff',{doc:next.document});await page.goto(origin+'/claim.html#'+nextHandoff.token);await page.waitForURL('**/viewer.html?doc='+next.document);await page.waitForTimeout(900);await page.locator('#agent-versions summary').click();await page.locator('#agent-versions select').selectOption(one.document);await page.locator('#agent-versions button').click();await page.waitForFunction(()=>document.querySelector('#agent-versions p p')?.textContent.includes('Located'));
 check('explicit versions preserve prior content/raw/assets/overlay/comments/replies; exact/duplicate/removed locate; native version navigation does not copy records');
 await writeFile(fixture+'/missing.html','<html><p>missing</p><img src="absent.png"></html>');assert.match((await call(['open',fixture+'/missing.html'],5)).error.message,/missing_resource/);
 await writeFile(fixture+'/escape.html','<html><img src="../private.png"></html>');assert.match((await call(['open',fixture+'/escape.html'],5)).error.message,/boundary/);
 await writeFile(root+'/outside.css','body{}');await symlink(root+'/outside.css',fixture+'/escaped.css');await writeFile(fixture+'/symlink.html','<html><link rel="stylesheet" href="escaped.css"></html>');assert.match((await call(['open',fixture+'/symlink.html'],5)).error.message,/symlink_escape/);
 await writeFile(fixture+'/plain.html','not html');assert.equal((await call(['open',fixture+'/plain.html'],5)).error.code,'not_html');assert.equal((await call(['comments','http://user:pass@127.0.0.1/viewer.html?doc=x'],2)).error.code,'invalid_url');
 check('missing, traversal, symlink, non-HTML and credential URL failures have stable JSON/nonzero exits');
 // The existing browser modal consumes the very same import manifest endpoint.
 const webctx=await browser.newContext({viewport:{width:390,height:844}}),web=await webctx.newPage();
 await web.goto(origin+'/');await web.locator('#import').click();
 await web.locator('#htmlFile').setInputFiles({name:'web.html',mimeType:'text/html',buffer:Buffer.from('<html><head><title>Web import</title></head><body><p>Web-only synthetic document</p></body></html>')});
 await web.locator('#doImport').click();await web.waitForURL('**/viewer.html?doc=review-*');assert((await (await webctx.request.get(origin+'/api/doc/'+new URL(web.url()).searchParams.get('doc'))).json()).isDocOwner);
 await webctx.close();check('existing mobile native import modal uses shared bundle contract and returns browser-owned review');

 // Installed service restart: verify exact task-owned argv and instance before signalling.
 await stop();const reopened=await call(['open',fixture+'/article.html']);ownedState=JSON.parse(await readFile(data+'/service.json'));origin=ownedState.origin;assert.equal(origin,new URL(one.reviewUrl).origin);assert.equal(reopened.document,removed.document);assert.equal(reopened.instanceId,one.instanceId);const newOldUrl=origin+'/viewer.html?doc='+one.document;assert.equal((await call(['comments',newOldUrl])).records[0].id,record.id);await page.goto(newOldUrl);await page.waitForTimeout(900);assert((await (await ctx.request.get(origin+'/api/doc/earlier-browser')).json()).isDocOwner);assert.equal((await call(['comments',newOldUrl])).records[0].replies[0].body,'Exact reply retained');
 check('verified owned service restart retains documents/assets/machine credentials/browser identity/comments/replies');
 assert.deepEqual(errors,[]);
 await writeFile(out+'/agent-receipt.json',JSON.stringify({checks,tarball,tarballSha256:hash(await readFile(tarball)),runtime:process.version,installed:prefix,service:ownedState,first:one.document,record,latest:removed.document,errors},null,2));console.log('ARTIFACT_ROOT '+root);
}finally{await browser?.close();await stop();if(occupied)await new Promise(r=>occupied.close(r));}
