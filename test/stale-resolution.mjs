// Bounded integration: real HTTP + disposable on-disk SQLite + Chromium.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {launchBrowser} from './helpers/browser.mjs';
const root=path.resolve(process.env.STALE_RUNTIME||'.'),out=path.resolve(process.env.STALE_ARTIFACTS||'review-artifacts/stale/evidence');
const dir=await mkdtemp(path.join(process.env.TMPDIR,'stale-resolution-'));await mkdir(out,{recursive:true});
process.env.HS_DOCS_DIR=path.join(dir,'docs');await mkdir(process.env.HS_DOCS_DIR);
process.env.OWNER_KEY=randomBytes(32).toString('hex');process.env.SESSION_SECRET=randomBytes(32).toString('hex');process.env.MMW_WRITE_PER_MIN='10000';process.env.MMW_READ_PER_MIN='10000';
const {openDb,addSuggestion,getOverlay}=await import(pathToFileURL(path.join(root,'db.js')));
const {createApp}=await import(pathToFileURL(path.join(root,'server.js')));
let db=openDb(path.join(dir,'fixture.db')),server,browser;const evidence=[];
const sha=t=>createHash('sha256').update(t).digest('hex');
const source=async(id,html)=>writeFile(path.join(process.env.HS_DOCS_DIR,id+'.html'),html);
try{
 server=await new Promise(r=>{const s=createApp(db).listen(0,'127.0.0.1',()=>r(s))});const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(id,sid,action,owner=true,body={})=>{const r=await fetch(`${base}/api/suggest/${id}/${sid}/${action}`,{method:'POST',headers:{connection:'close','content-type':'application/json',...(owner?{'x-owner-key':process.env.OWNER_KEY}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()}};
 const rows=async id=>(await (await fetch(base+`/api/suggestions/${id}?status=all`,{headers:{connection:'close'}})).json()).suggestions;
 const seed=async(id,text='A cat and a dog.',suffix='')=>{const html=`<p>${text}</p>${suffix}`;await source(id,html);const row=addSuggestion(db,{id:randomBytes(12).toString('hex'),doc_id:id,anchor:sha(text),quote:'cat',body:'CAT',base_text:text,range_start:2,range_end:5,kind:'rewrite',author:'Same name',created_at:new Date().toISOString()});db.prepare('UPDATE suggestions SET source_hash=? WHERE id=?').run(sha(html),row.id);return row};
 // Baseline reproduction before implementation: old open/hash drift blocks accept,
 // and DB stale has no closeout route. This suite requires the actual closeout.
 let row=await seed('open-drift');await call('open-drift',row.id,'replies',true,{body:'Saved historical discussion',author:'Reply author'});await source('open-drift','<p>A changed paragraph.</p>');
 assert.equal((await rows('open-drift'))[0].status,'open');assert((await rows('open-drift'))[0].invalid_reason);
 const raw=await readFile(path.join(process.env.HS_DOCS_DIR,'open-drift.html'),'utf8');
 const closed=await call('open-drift',row.id,'resolve-stale');assert.equal(closed.status,200);assert.equal(closed.data.suggestion.status,'rejected');assert.equal(closed.data.suggestion.resolved_stale,true);assert(closed.data.suggestion.stale_reason);assert.equal(closed.data.suggestion.replies[0].body,'Saved historical discussion');
 assert.equal((await call('open-drift',row.id,'resolve-stale')).data.replayed,true);assert.equal((await call('open-drift',row.id,'accept')).status,409);assert.equal((await call('open-drift',row.id,'reopen')).status,409);assert.equal(await readFile(path.join(process.env.HS_DOCS_DIR,'open-drift.html'),'utf8'),raw);assert.deepEqual(getOverlay(db,'open-drift'),{});
 assert.equal(db.prepare("SELECT count(*) n FROM rewrite_history WHERE suggestion_id=? AND operation='RESOLVE_STALE'").get(row.id).n,1);
 row=await seed('db-stale');db.prepare("UPDATE suggestions SET status='stale' WHERE id=?").run(row.id);
 for(const [id,sid,owner,status] of [['db-stale',row.id,false,403],['db-stale','absent',true,404],['elsewhere',row.id,true,404]])assert.equal((await call(id,sid,'resolve-stale',owner)).status,status);
 assert.equal((await call('db-stale',row.id,'accept')).status,409);assert.equal((await call('db-stale',row.id,'resolve-stale')).status,200);assert.deepEqual(getOverlay(db,'db-stale'),{});
 // Simultaneous tabs: invalid accept cannot win; duplicate closeout is idempotent.
 row=await seed('race');await source('race','<p>Deleted target, unrelated exact cat.</p>');
 const race=await Promise.all([call('race',row.id,'accept'),call('race',row.id,'resolve-stale'),call('race',row.id,'resolve-stale')]);assert.equal(race[0].status,409);assert(race.slice(1).every(r=>r.status===200));assert.deepEqual(getOverlay(db,'race'),{});
 row=await seed('valid');assert.equal((await call('valid',row.id,'resolve-stale',true,{stale:true})).status,409);assert.equal((await rows('valid'))[0].status,'open');assert.equal((await call('valid',row.id,'accept')).status,200);assert.equal(getOverlay(db,'valid')[row.anchor].text,'A CAT and a dog.');
 // Unrelated source edit must not permanently stale a still-exact unique target.
 row=await seed('unrelated');await source('unrelated','<p>A cat and a dog.</p><p>New unrelated paragraph.</p>');assert.equal((await rows('unrelated'))[0].invalid_reason,null);assert.equal((await call('unrelated',row.id,'accept')).status,200);
 row=await seed('duplicates','A cat and a dog.','<p>A cat and a dog.</p>');await source('duplicates','<p>A cat and a dog.</p><p>A cat and a dog.</p><p>Extra.</p>');assert.equal((await call('duplicates',row.id,'accept')).status,409);
 row=await seed('loaded-then-drift');await source('loaded-then-drift','<p>A new cat and a dog.</p>');assert.equal((await call('loaded-then-drift',row.id,'accept')).status,409);assert.equal((await rows('loaded-then-drift'))[0].status,'stale');assert.deepEqual(getOverlay(db,'loaded-then-drift'),{});
 // Persisted metadata survives a real database reopen (same HTTP app uses handle).
 db.close();db=openDb(path.join(dir,'fixture.db'));assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal((await import(pathToFileURL(path.join(root,'db.js')))).getSuggestion(db,closed.data.suggestion.id).replies.length,1);
 await new Promise(r=>server.close(r));server=await new Promise(r=>{const s=createApp(db).listen(Number(new URL(base).port),'127.0.0.1',()=>r(s))});assert((await rows('open-drift'))[0].resolved_stale);
 console.log('PASS API: open drift, DB stale, source unchanged, replies/history/reopen, owner-only/404/cross-doc, forged stale rejection, concurrent accepts/closeouts, valid/unrelated changes, duplicates, database reopen');
 if(process.env.STALE_API_ONLY!=='1'){
 browser=await launchBrowser();
 for(const route of ['ordinary','static'])for(const width of [1440,390]){
  const ctx=await browser.newContext({viewport:{width,height:1000}}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await ctx.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await page.goto(base+'/?key='+process.env.OWNER_KEY);await page.waitForFunction(()=>!location.search.includes('key='));
  const id=`browser-${route}-${width}`,text='Original target cat with safe emphasis.',anchor=sha(text);
  const html=`<style>body{font:20px/1.7 system-ui;padding:24px}#nested{height:150px;overflow:auto}</style><h1>Stale suggestion closeout</h1><p id="target">${text}</p><input id="retained" value="original"><div id="nested"><div style="height:400px">Nested reading</div></div><p id="draft-target">Independent inline draft target.</p>${Array.from({length:15},(_,i)=>`<p>Reading section ${i}. ${'Unchanged prose. '.repeat(15)}</p>`).join('')}`;
  await page.locator('#import').click();await page.locator('#htmlFile').setInputFiles({name:id+'.html',mimeType:'text/html',buffer:Buffer.from(html)});await page.locator('#doImport').click();await page.waitForURL('**/viewer.html?doc='+id);
  const post=async()=>{const r=await ctx.request.post(base+'/api/suggest/'+id,{data:{anchor,quote:'cat',body:'CAT',baseText:text,rangeStart:text.indexOf('cat'),rangeEnd:text.indexOf('cat')+3,kind:'rewrite',author:'Synthetic author'}});assert(r.ok(),await r.text());return (await r.json()).suggestion};
  const suggestion=await post();await ctx.request.post(base+`/api/suggest/${id}/${suggestion.id}/replies`,{data:{body:'Historical reply retained',author:'Historical reviewer'}});
  const extra=addSuggestion(db,{...suggestion,id:randomBytes(12).toString('hex'),status:'stale'});
  // Ordinary case: locally orphaned DB-open; static: actual persisted stale.
  await source(id,html.replace(`<p id="target">${text}</p>`,'<p id="target">Replacement paragraph without old identity.</p>'));
  if(route==='static')db.prepare("UPDATE suggestions SET status='stale' WHERE id=?").run(suggestion.id);
  const ready=async()=>{await page.waitForFunction(()=>document.querySelector('#hs-status')?.textContent.includes('已同步'));await page.waitForFunction(()=>document.querySelector('iframe')?.dataset.previewScale);let src=page.frames()[1];await src.waitForSelector('#retained');if(route==='ordinary'){await page.locator('#preview-mode').evaluate(n=>{n.add(new Option('test ordinary renderer','article'));n.value='article';n.dispatchEvent(new Event('change'))});src=page.mainFrame()}await page.waitForTimeout(200);return src};
  await page.reload();let src=await ready();if(!await page.locator('#discussion').isVisible())await page.locator('.comment-toggle:visible,.show-discussion:visible').first().click();await page.locator('[data-filter=open]').click();
  const card=page.locator('#thread-'+suggestion.id),button=card.locator('[data-stale-resolve]');await button.waitFor();assert.equal(await card.locator('[data-accept],[data-reject],[data-locate]').count(),0);assert(!((await card.textContent()).includes('等待所有者确认')));assert.equal((await rows(id))[0].status,route==='ordinary'?'open':'stale');
  const input=await src.locator('#retained').elementHandle(),target=await src.locator('#target').elementHandle(),frame=route==='static'?await page.locator('iframe').elementHandle():null;
  await src.locator('#retained').evaluate(n=>n.value='unsaved input retained');await src.evaluate(()=>{window.savedNode=document.querySelector('#target');document.querySelector('#nested').scrollTop=100;scrollTo(0,50)});
  const snapshot=()=>src.evaluate(()=>({y:scrollY,nested:document.querySelector('#nested').scrollTop,input:document.querySelector('#retained').value}));const before=await snapshot();
  // Capture unobstructed pending UX, then independently prove a reply draft
  // survives another target's status-only mutation (no artificial click-through).
  await page.screenshot({path:out+`/${route}-${width}-before.png`});
  await card.locator('[data-reply]').click();await page.locator('#comment-body').fill('Unsent separate reply');
  await page.locator(`[data-stale-resolve="${extra.id}"]`).dispatchEvent('click');await page.locator('#thread-'+extra.id).waitFor({state:'detached'});assert.equal(await page.locator('#comment-body').inputValue(),'Unsent separate reply');
  await page.locator('#comment-body').fill('');await page.locator('#cancel-comment').click();
  // A distinct native inline draft stays connected through the real pointer
  // closeout. Scrolling/focus from entering that draft is the baseline, not loss.
  await page.locator(width<600?'.dock [data-mode=suggest]':'.topbar [data-mode=suggest]').click();await page.waitForTimeout(150);await src.locator('#draft-target').dispatchEvent('keydown',{key:'Enter'});await page.locator('#selection-suggest').waitFor({state:'visible'});await page.locator('#selection-suggest').click();await src.locator('[data-inline-editor]').waitFor();await page.keyboard.insertText(' UNSENT');const editor=await src.locator('[data-inline-editor]').elementHandle(),draftText=await editor.textContent();
  await button.evaluate(n=>{const v=document.querySelector('#threads');v.scrollTop+=n.getBoundingClientRect().top-v.getBoundingClientRect().top-250});const draftBefore=await snapshot();await button.click();await card.waitFor({state:'detached'});
  assert.deepEqual(await snapshot(),draftBefore);assert(await input.evaluate(n=>n.isConnected));assert(await target.evaluate(n=>n===window.savedNode));if(frame)assert(await frame.evaluate(n=>n.isConnected));assert(await editor.evaluate(n=>n.isConnected));assert.equal(await editor.textContent(),draftText);assert.equal((await rows(id))[0].resolved_stale,true);assert.deepEqual(getOverlay(db,id),{});
  await page.locator('#cancel-draft').click();
  await page.locator('[data-filter=done]').click();await card.waitFor();assert((await card.textContent()).includes('Historical reply retained'));assert((await card.textContent()).includes('正文未修改'));assert.equal(await card.locator('[data-accept],[data-reject],[data-locate],[data-reopen],[data-stale-resolve]').count(),0);await page.screenshot({path:out+`/${route}-${width}-after.png`});
  await page.reload();src=await ready();if(!await page.locator('#discussion').isVisible())await page.locator('.comment-toggle:visible,.show-discussion:visible').first().click();await page.locator('[data-filter=done]').click();await card.waitFor();assert((await card.textContent()).includes('Historical reply retained'));assert((await card.textContent()).includes('失效建议'));assert.equal(await card.locator('[data-accept],[data-locate],[data-reopen]').count(),0);
  // UI was loaded while valid, but the authoritative source disappears before
  // Accept reaches the server. Rejection and subsequent closeout stay in place.
  const lateText='Independent inline draft target.',lateAnchor=sha(lateText);
  const lateResponse=await ctx.request.post(base+'/api/suggest/'+id,{data:{anchor:lateAnchor,quote:'Independent',body:'Separate',baseText:lateText,rangeStart:0,rangeEnd:11,kind:'rewrite',author:'Late tab'}});assert(lateResponse.ok());const late=(await lateResponse.json()).suggestion;
  await page.reload();src=await ready();if(!await page.locator('#discussion').isVisible())await page.locator('.comment-toggle:visible,.show-discussion:visible').first().click();await page.locator('[data-filter=open]').click();const lateCard=page.locator('#thread-'+late.id);await lateCard.locator('[data-accept]').waitFor();
  const lateInput=await src.locator('#retained').elementHandle();await src.locator('#retained').evaluate(n=>n.value='late input survives');const lateFrame=route==='static'?await page.locator('iframe').elementHandle():null;
  const lateHtml=(await readFile(path.join(process.env.HS_DOCS_DIR,id+'.html'),'utf8')).replace(lateText,'Changed unrelated content.');await source(id,lateHtml);
  await lateCard.locator('[data-accept]').click();await lateCard.locator('[data-stale-resolve]').waitFor();assert.equal(await lateCard.locator('[data-accept],[data-locate]').count(),0);assert(await lateInput.evaluate(n=>n.isConnected&&n.value==='late input survives'));if(lateFrame)assert(await lateFrame.evaluate(n=>n.isConnected));await src.waitForFunction(id=>!document.querySelector(`[data-review-ins][data-thread="${id}"]`),late.id);
  await lateCard.locator('[data-stale-resolve]').click();await lateCard.waitFor({state:'detached'});assert(await lateInput.evaluate(n=>n.isConnected&&n.value==='late input survives'));assert.equal(await readFile(path.join(process.env.HS_DOCS_DIR,id+'.html'),'utf8'),lateHtml);assert.deepEqual(getOverlay(db,id),{});
  await page.locator('#discussion-list-toggle').click();await page.locator('[data-status=done]').click();assert((await page.locator('#list-'+suggestion.id).textContent()).includes('已处理 · 失效建议'));assert.equal(await page.locator('.total').first().textContent(),'0');assert.deepEqual(errors,[]);evidence.push({route,width,stateBefore:route==='ordinary'?'open':'stale',persisted:true,reading:before,inputIdentity:true,frameIdentity:true,replyDraft:true,inlineDraft:true,lateAcceptRejectedInPlace:true});await ctx.close();
 }
 }
 await writeFile(out+'/evidence.json',JSON.stringify(evidence,null,2));console.log('PASS Chromium stale closeout '+evidence.length+' cases');
}finally{await browser?.close();if(server)await new Promise(r=>server.close(r));db.close();await rm(dir,{recursive:true,force:true})}
