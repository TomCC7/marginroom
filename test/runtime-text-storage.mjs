// Native Chromium input, real isolated HTTP/SQLite; never connects to production.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import net from 'node:net';
import Database from 'better-sqlite3';
import {launchBrowser} from './helpers/browser.mjs';
const app=process.env.APP_DIR||new URL('..',import.meta.url).pathname;
const out=process.env.RUNTIME_ARTIFACTS||path.join(app,'review-artifacts/runtime-text');await mkdir(out,{recursive:true});
const dir=await mkdtemp(path.join(process.env.TMPDIR||tmpdir(),'runtime-text-'));
const privateDoc=process.env.PRIVATE_DOC?JSON.parse(await readFile(process.env.PRIVATE_DOC,'utf8')):null;
const id=privateDoc?'metal-arm-payload-plan-v2':'runtime-text';
const html=privateDoc?.baseHtml||'<html><head><style>body{font:18px/1.8 sans-serif;padding:24px}p{max-width:620px}#runtime-scope{padding:20px}</style></head><body><h1>Selection fixture</h1><p id="canonical">Canonical same same 😀 paragraph with safe inline <strong>formatting</strong>.</p><p id="canonical-inline">Independent inline revision control with safe <strong>formatting</strong>, never commented.</p><section id="runtime-scope"></section></body></html>';
await mkdir(path.join(dir,'docs'));await writeFile(path.join(dir,'docs',id+'.html'),html);
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const base='http://127.0.0.1:'+port;
let browser,child,lastPage,lastProbe,logs='';const evidence={private:!!privateDoc,before:!!process.env.EXPECT_BROKEN,cases:[]};
try{
 child=spawn(process.execPath,['server.js'],{cwd:app,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),HS_DB_PATH:path.join(dir,'app.db'),HS_DOCS_DIR:path.join(dir,'docs'),SESSION_SECRET:randomBytes(32).toString('hex'),OWNER_KEY:randomBytes(32).toString('hex')},stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 for(let i=0;i<120;i++){try{if((await fetch(base+'/api/whoami')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await launchBrowser();
 for(const width of process.env.EXPECT_BROKEN?[1440]:[1440,390]){
  const ctx=await browser.newContext({viewport:{width,height:1000},hasTouch:width===390});const errors=[];
  await ctx.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  const page=await ctx.newPage();lastPage=page;page.on('pageerror',e=>errors.push(e.message));
  const messages=[];await page.exposeFunction('recordSelection',m=>messages.push(m));await page.addInitScript(()=>addEventListener('message',e=>{if(e.data?.channel==='static-preview'&&e.data.type==='selection')window.recordSelection(e.data)}));
  let frame;
  async function ready(){await page.waitForFunction(()=>document.querySelector('iframe.hs-static-preview')?.dataset.previewScale);frame=page.frames().find(f=>f!==page.mainFrame());await frame.waitForFunction(()=>document.body);await page.waitForTimeout(600);
   if(!privateDoc)await frame.evaluate(()=>{document.querySelector('#runtime-scope').innerHTML='<p hidden>Runtime same same 😀 text.</p><p class="runtime">Runtime same same 😀 text.</p><p class="runtime">Runtime same same 😀 text.</p><p class="next">Other block.</p>'});
  }
  await page.goto(base+'/viewer.html?doc='+id);await ready();
  const original=await ctx.request.get(base+'/api/doc/'+id).then(r=>r.json());assert.equal(original.hasRaw,false);assert(original.canSuggest);
  await page.locator(width<600?'.dock [data-mode="suggest"]':'.topbar [data-mode="suggest"]').click();await page.waitForTimeout(200);
  const selector=privateDoc?'.metal-diagram-legend':'.runtime';
  if(privateDoc)await frame.evaluate(()=>{for(const p of document.querySelectorAll('.metal-diagram-legend'))for(let n=p.parentElement;n;n=n.parentElement)if(n.tagName==='DETAILS')n.open=true});
  const target=frame.locator(selector).first();
  async function nativeDrag(locator,start=0,end=null){if(width<600&&await page.locator('#discussion .close-drawer').isVisible()){await page.locator('#discussion .close-drawer').click();await page.waitForTimeout(200)}await frame.evaluate(()=>getSelection().removeAllRanges());await page.waitForTimeout(100);await locator.evaluate(n=>n.scrollIntoView({block:'center'}));await page.waitForTimeout(200);const points=await locator.evaluate((el,{start,end})=>{const w=document.createTreeWalker(el,4),nodes=[];let t;while(t=w.nextNode())nodes.push(t);const full=el.textContent;end??=Math.min(full.length,20);function point(at){let pos=0;for(const n of nodes){if(pos+n.length>at){const r=document.createRange();r.setStart(n,at-pos);r.setEnd(n,at-pos+1);const b=r.getBoundingClientRect();return {x:b.x,y:b.y+b.height/2}}pos+=n.length}throw Error('point outside text')}const a=point(start),b=point(end-1),r=document.createRange();let pos=0;for(const n of nodes){if(pos+n.length>=end){r.setStart(n,end-pos-1);r.setEnd(n,end-pos);break}pos+=n.length}b.x=r.getBoundingClientRect().right;return {a,b}},{start,end});const b=await page.locator('iframe').boundingBox(),scale=await page.locator('iframe').evaluate(n=>n.getBoundingClientRect().width/n.offsetWidth);await page.mouse.move(b.x+points.a.x*scale+0.2,b.y+points.a.y*scale);await page.mouse.down();await page.mouse.move(b.x+points.b.x*scale-0.2,b.y+points.b.y*scale,{steps:16});await page.mouse.up();await page.waitForTimeout(500);return frame.evaluate(()=>getSelection().toString())}
  const requested='第二图）。手机可横向滚动看图，或打开',begin=privateDoc?(await target.textContent()).indexOf(requested):13;assert(begin>=0);const quote=await nativeDrag(target,begin,privateDoc?begin+requested.length:20);if(privateDoc)assert.equal(quote,requested);assert(quote.trim());assert.equal(await target.evaluate(n=>n.closest('[data-hs-anchor]')),null);
  const action=page.locator(width<600?'#mobile-comment':'#selection-action');
  if(process.env.EXPECT_BROKEN){assert(messages.some(m=>m.reason==='invalid'&&m.selection===null));assert(!await page.locator('#selection-action').isVisible());await page.screenshot({path:out+'/before.png'});evidence.cases.push({width,quote,messages:messages.slice(-3),action:false});break}
  // Mobile control ID is discovered from the existing dock; no new controls.
  const comment=width<600?page.locator('#mobile-selection button').first():action;
  await comment.waitFor({state:'visible'});assert(await page.locator('#selection-suggest').isHidden());await page.screenshot({path:out+`/after-${width}-action.png`});
  await comment.click();await page.locator('#composer').waitFor({state:'visible'});assert.equal(await page.locator('#selected-quote').textContent(),quote);await page.screenshot({path:out+`/after-${width}-composer.png`});
  const body=`Disposable runtime comment ${width}`;await page.locator('#comment-body').fill(body);const response=page.waitForResponse(r=>r.url()===base+'/api/suggest/'+id&&r.request().method()==='POST');await page.locator('#send-comment').click();const posted=await (await response).json();assert(posted.ok,JSON.stringify(posted));const sid=posted.suggestion.id;
  await page.waitForFunction(()=>document.querySelector('#composer').hidden);
  const rows=await ctx.request.get(base+'/api/suggestions/'+id+'?status=all').then(r=>r.json()).then(j=>j.suggestions),row=rows.find(r=>r.id===sid);assert(row);assert.equal(row.quote,quote);assert.equal(row.kind,'comment');assert.match(row.anchor,/^c3:/);assert.equal(row.base_text,'');assert.equal(row.range_start,null);assert.equal(row.range_end,null);
  const db=new Database(path.join(dir,'app.db'),{readonly:true});const stored=db.prepare('SELECT * FROM suggestions WHERE id=?').get(sid);db.close();assert.equal(stored.quote,quote);assert.equal(stored.body,body);
  await page.reload();await ready();if(width<600&&!await page.locator('#discussion').isVisible())await page.locator('.comment-toggle').click();await page.locator(`[data-locate="${sid}"]`).first().click();await page.waitForTimeout(400);
  const expected=await frame.locator(selector).first().boundingBox(),outline=await frame.locator('div[data-review-picked]').boundingBox();assert(expected&&outline);assert(Math.abs(expected.x-outline.x)<2&&Math.abs(expected.y-outline.y)<2,JSON.stringify({expected,outline}));
  // Canonical control uses the original source anchor and exact UTF-16 range.
  await page.locator(width<600?'.dock [data-mode="suggest"]':'.topbar [data-mode="suggest"]').click();await page.waitForTimeout(150);if(width<600&&await page.locator('#discussion').isVisible())await page.locator('.comment-toggle').click();
  const canonical=frame.locator('p[data-hs-anchor]').filter({hasText:privateDoc?'':'Canonical'}).first();const canonicalQuote=await nativeDrag(canonical,0,8);await comment.waitFor({state:'visible'});await comment.click();await page.locator('#comment-body').fill('Canonical control '+width);const cr=page.waitForResponse(r=>r.url()===base+'/api/suggest/'+id&&r.request().method()==='POST');await page.locator('#send-comment').click();const canonicalRow=(await (await cr).json()).suggestion;assert.equal(canonicalRow.quote,canonicalQuote);assert(!/^c[23]:/.test(canonicalRow.anchor));assert.equal(canonicalRow.range_start,0);assert.equal(canonicalRow.range_end,canonicalQuote.length);assert(canonicalRow.base_text.includes(canonicalQuote));await page.waitForFunction(()=>document.querySelector('#composer').hidden);
  if(!privateDoc){
   if(width<600&&await page.locator('#discussion .close-drawer').isVisible())await page.locator('#discussion .close-drawer').click();
   // Pick an uncommented canonical control, not the comment marker on #canonical.
   const inline=frame.locator('#canonical-inline');
   if(await page.locator('#composer').isVisible()){await page.locator('#close-composer').click();await page.waitForFunction(()=>document.querySelector('#composer').hidden)}
   if(width<600&&await page.locator('#discussion').isVisible()){await page.locator('#discussion .close-drawer').click();await page.waitForTimeout(200)}
   await frame.evaluate(()=>getSelection().removeAllRanges());await inline.evaluate(n=>n.scrollIntoView({block:'center'}));await page.waitForTimeout(200);
   const local=await inline.evaluate(el=>{const r=document.createRange();r.setStart(el.firstChild,2);r.setEnd(el.firstChild,3);const b=r.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;return {x,y,hitId:document.elementFromPoint(x,y)?.closest('p')?.id,anchor:el.dataset.hsAnchor}});
   assert.equal(local.hitId,'canonical-inline');assert(local.anchor&&!/^c[23]:/.test(local.anchor));assert.notEqual(local.anchor,canonicalRow.anchor);
   const fb=await page.locator('iframe').boundingBox(),scale=await page.locator('iframe').evaluate(n=>n.getBoundingClientRect().width/n.offsetWidth);
   const sx=fb.x+local.x*scale,sy=fb.y+local.y*scale;
   const shellHit=await page.evaluate(({x,y})=>{const n=document.elementFromPoint(x,y);return n?{tag:n.tagName,id:n.id,cls:n.className}:null},{x:sx,y:sy});
   assert.equal(shellHit?.tag,'IFRAME','click point must be the preview frame, not shell chrome: '+JSON.stringify({local,shellHit,frame:fb,scale}));
   await page.mouse.click(sx,sy);await page.waitForTimeout(450);
   lastProbe={local,shellHit,frame:fb,scale,label:await page.locator('#target-label').textContent(),tag:await page.locator('#target-tag').textContent()};
   assert.match(lastProbe.label,new RegExp('^p #canonical-inline: '));assert.equal(lastProbe.tag,'p');
   await page.locator('#selection-suggest').waitFor({state:'visible'});assert(await page.locator('#selection-suggest').isEnabled());
   await page.screenshot({path:out+`/canonical-inline-${width}.png`});
   evidence.canonicalInline??=[];evidence.canonicalInline.push({width,...lastProbe});
   await page.locator('#selection-suggest').click();await frame.locator('[data-inline-editor]').waitFor();await page.keyboard.insertText('Disposable draft');await page.locator('#cancel-draft').click();await page.waitForFunction(()=>document.querySelector('#draft-actions').hidden);
   const rewriteRow=(await ctx.request.get(base+'/api/suggestions/'+id+'?status=all').then(r=>r.json())).suggestions.find(r=>r.kind==='rewrite');assert.equal(rewriteRow,undefined,'canceled inline draft stores nothing');
   if(width<600&&await page.locator('#discussion').isVisible())await page.locator('.comment-toggle').click();
   // Genuine cross-block selection is rejected, not enlarged to a container.
   await frame.evaluate(()=>{const a=document.querySelector('.runtime'),b=document.querySelector('.next'),r=document.createRange();r.setStart(a.firstChild,0);r.setEnd(b.firstChild,3);getSelection().removeAllRanges();getSelection().addRange(r)});await page.waitForTimeout(350);assert(!await comment.isVisible());
   // Native word selection and existing explicit element comments still work.
   await nativeDrag(frame.locator('.runtime').nth(1),0,7);await comment.waitFor({state:'visible'});assert.notEqual(messages.findLast(m=>m.selection)?.anchor,row.anchor,'repeated visible paragraph has distinct c3 identity');
   await frame.evaluate(()=>{const n=document.querySelector('[hidden]'),r=document.createRange();r.selectNodeContents(n);getSelection().removeAllRanges();getSelection().addRange(r)});await page.waitForTimeout(200);assert(!await comment.isVisible(),'hidden duplicate is not a valid selection target');
   await frame.evaluate(()=>getSelection().removeAllRanges());await frame.locator('.runtime').nth(1).evaluate(n=>n.scrollIntoView({block:'center'}));await page.waitForTimeout(150);const b=await frame.locator('.runtime').nth(1).boundingBox();await page.mouse.click(b.x+40,b.y+12,{clickCount:2});await page.waitForTimeout(450);await comment.waitFor({state:'visible'});assert.equal(await frame.evaluate(()=>getSelection().toString()),'Runtime');
   await frame.evaluate(()=>getSelection().removeAllRanges());await page.mouse.click(b.x+40,b.y+12);await page.waitForTimeout(450);await page.locator('#selection-action').waitFor({state:'visible'});assert.match(await page.locator('#target-label').textContent(),/^p:/);
   // Scope drift must never silently locate the second identical paragraph.
   await frame.locator('.runtime').first().evaluate(n=>n.textContent+=' changed');if(width<600&&!await page.locator('#discussion').isVisible())await page.locator('.comment-toggle').click();await page.locator(`[data-locate="${sid}"]`).first().click();await page.waitForTimeout(400);assert.match(await page.locator('#thread-'+sid).textContent(),/无法安全定位|element changed, is missing or is ambiguous/);
  }
  const now=await ctx.request.get(base+'/api/doc/'+id).then(r=>r.json());assert.equal(now.baseHtml,original.baseHtml);assert.deepEqual(now.overlay,original.overlay);assert.deepEqual(errors,[]);
  evidence.cases.push({width,quote,id:sid,anchor:row.anchor,sqlite:true,reloadExactTarget:true,canonical:{id:canonicalRow.id,quote:canonicalQuote,anchor:canonicalRow.anchor,start:canonicalRow.range_start,end:canonicalRow.range_end},errors});await ctx.close();
 }
 await writeFile(out+'/result.json',JSON.stringify(evidence,null,2));console.log('PASS runtime-text '+JSON.stringify(evidence));
}catch(e){if(lastPage&&!lastPage.isClosed()){await lastPage.screenshot({path:out+'/failure.png'});console.error(lastProbe);console.error(await lastPage.frames()[1].evaluate(()=>({selection:getSelection().toString(),scroll:[scrollX,scrollY]})))}console.error(logs);throw e}finally{await browser?.close();if(child){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r))}await rm(dir,{recursive:true,force:true})}
