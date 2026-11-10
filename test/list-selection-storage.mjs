// Real upload/suggestion/accept/export against disposable SQLite + docs only.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import net from 'node:net';
import Database from 'better-sqlite3';
import {JSDOM} from 'jsdom';
import {launchBrowser} from './helpers/browser.mjs';
const dir=await mkdtemp(path.join(process.env.TMPDIR||tmpdir(),'list-selection-')),out=process.env.STORAGE_ARTIFACTS;
if(out)await mkdir(out,{recursive:true});
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const base=`http://127.0.0.1:${port}`,key=randomBytes(32).toString('hex');let child,browser,output='';
try{
 await mkdir(path.join(dir,'docs'));child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),HS_DB_PATH:path.join(dir,'app.db'),HS_DOCS_DIR:path.join(dir,'docs'),SESSION_SECRET:randomBytes(32).toString('hex'),OWNER_KEY:key},stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 for(let i=0;i<150;i++){try{if((await fetch(base+'/api/whoami')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await launchBrowser();const ctx=await browser.newContext({viewport:{width:1440,height:900}}),errors=[];ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await ctx.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 const page=await ctx.newPage();await page.goto(base+'/?key='+key);await page.waitForFunction(()=>!location.search.includes('key='));
 const quote='same local 😀 same local. '+ 'Wrapped paragraph text for review. '.repeat(4),html='<style>body{font:18px/1.8 system-ui}li{max-width:600px}</style><h1>List storage</h1><ul id="items"><li id="before">Untouched <em>first sibling</em></li>\n  <li id="target">'+quote+'</li>\n  <li id="after">Untouched <strong>last sibling</strong></li></ul><p id="paragraph">Other paragraph.</p>';
 await page.locator('input[type=file]').first().setInputFiles({name:'list-synthetic.html',mimeType:'text/html',buffer:Buffer.from(html)});await page.waitForURL('**/viewer.html?doc=list-synthetic');await page.waitForFunction(()=>document.querySelector('#hs-status')?.textContent.includes('已同步'));await page.waitForFunction(()=>document.querySelector('iframe')?.dataset.previewScale);
 let frame=page.frames()[1];await page.locator('.topbar [data-mode="suggest"]').click();const anchor=await frame.locator('#target').getAttribute('data-hs-anchor');const original=await ctx.request.get(base+'/api/doc/list-synthetic').then(r=>r.json()),payloads=[];
 page.on('request',req=>{if(req.method()==='POST'&&req.url()===base+'/api/suggest/list-synthetic')payloads.push(req.postDataJSON())});
 const records=()=>ctx.request.get(base+'/api/suggestions/list-synthetic?status=all').then(r=>r.json()).then(j=>j.suggestions);
 const select=async(start,end)=>frame.locator('#target').evaluate((el,{start,end})=>{el.focus();const r=document.createRange();r.setStart(el.firstChild,start);r.setEnd(el.firstChild,end);getSelection().removeAllRanges();getSelection().addRange(r)},{start,end});
 // Native double then triple; raw end is next li offset0. Submit through actual UI.
 await page.selectOption('#preview-mode','phone');await frame.waitForFunction(()=>innerWidth===390);
 await frame.locator('#target').evaluate(n=>n.scrollIntoView({block:'center'}));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const position=await frame.locator('#target').evaluate(el=>{const r=document.createRange();r.setStart(el.firstChild,5);r.setEnd(el.firstChild,10);const b=r.getBoundingClientRect();return {x:b.x+5,y:b.y+8}}),box=await page.locator('iframe').boundingBox(),scale=await page.locator('iframe').evaluate(n=>+n.dataset.previewScale),x=box.x+position.x*scale,y=box.y+position.y*scale;
 await page.mouse.click(x,y,{clickCount:2});await page.locator('#selection-action').waitFor({state:'visible'});await page.mouse.click(x,y,{clickCount:3});await page.locator('#selection-action').click();await page.locator('#composer').waitFor({state:'visible'});assert.equal(await page.locator('#selected-quote').textContent(),quote);await page.locator('#comment-body').fill('native whole paragraph');await page.locator('#send-comment').click();await page.waitForFunction(()=>document.querySelector('#composer').hidden);
 let stored=await records(),comment=stored.find(s=>s.kind==='comment');assert.equal(comment.anchor,anchor);assert.equal(comment.quote,quote);assert.equal(comment.range_start,0);assert.equal(comment.range_end,quote.length);
 // Remove decoration by switching to edit then back to suggest; repeated occurrence
 // selection must refer to original UTF16 text, not earlier quote or shell Range.
 await page.locator('.topbar [data-mode="suggest"]').click();await page.waitForTimeout(120);
 // Decorations split text nodes: use the exact logical UTF16 range helper in-frame.
 const start=quote.lastIndexOf('local'),end=start+5;
 await page.locator('#hs-docname').dblclick();await frame.locator('#target').dispatchEvent('keydown',{key:'Enter'});await page.locator('#selection-suggest').waitFor({state:'visible'});await page.locator('#selection-suggest').click();await frame.locator('[data-inline-editor]').waitFor();assert.equal(await frame.locator('[data-inline-editor]').textContent(),quote);await frame.locator('[data-inline-editor]').evaluate((el,{start,end})=>{const r=document.createRange();r.setStart(el.firstChild,start);r.setEnd(el.firstChild,end);getSelection().removeAllRanges();getSelection().addRange(r)},{start,end});await page.keyboard.insertText('replacement');
 await page.locator('#preview-dock-toggle').dispatchEvent('click');await page.locator('#preview-dock-toggle').dispatchEvent('click');assert.equal(await frame.locator('[data-inline-editor]').textContent(),quote.slice(0,start)+'replacement'+quote.slice(end));await page.locator('#submit-draft').click();await page.waitForFunction(()=>document.querySelector('#draft-actions').hidden);
 stored=await records();const rewrite=stored.find(s=>s.kind==='rewrite');assert.equal(rewrite.anchor,anchor);assert.equal(rewrite.quote,'local');assert.equal(rewrite.body,'replacement');assert.equal(rewrite.range_start,start);assert.equal(rewrite.range_end,end);assert.equal(rewrite.base_text,quote);
 // Exact overlap is actionable, unlike a crossparagraph error; no new record.
 const count=stored.length;await frame.locator('#target').dispatchEvent('keydown',{key:'Enter'});await page.waitForTimeout(120);assert.equal((await page.locator('#selection-suggest').textContent()).trim(),'查看修订');assert.match(await page.locator('#rewrite-reason').textContent(),/此处已有修订/);assert.equal((await records()).length,count);assert(!await page.locator('#draft-actions').isVisible());
 await page.locator(`[data-accept="${rewrite.id}"]`).click();await page.waitForFunction(()=>document.querySelector('#hs-status').textContent.includes('已接受修改'));frame=page.frames()[1];const expected=quote.slice(0,start)+'replacement'+quote.slice(end);await frame.waitForFunction(t=>document.querySelector('#target').textContent===t,expected);
 assert.equal(await frame.locator('#target').getAttribute('data-hs-anchor'),anchor);assert.equal(await frame.locator('#items>li').count(),3);assert.equal(await frame.locator('#before em').textContent(),'first sibling');assert.equal(await frame.locator('#after strong').textContent(),'last sibling');
 const final=await ctx.request.get(base+'/api/doc/list-synthetic').then(r=>r.json());assert.equal(final.baseHtml,original.baseHtml);assert.deepEqual(Object.keys(final.overlay),[anchor]);assert.equal(final.overlay[anchor].text,expected);
 // Native viewer export, parsed independently. Only intended li changes.
 await page.locator('#more-btn').click();const downloadPromise=page.waitForEvent('download');await page.locator('#export-menu').click();const download=await downloadPromise,exported=await readFile(await download.path(),'utf8'),parsed=new JSDOM(exported).window.document;
 assert.equal(parsed.querySelector('#target').textContent,expected);assert.equal(parsed.querySelectorAll('#items>li').length,3);assert.equal(parsed.querySelector('#before em').textContent,'first sibling');assert.equal(parsed.querySelector('#after strong').textContent,'last sibling');assert(!parsed.querySelector('[data-hs-anchor]'));
 // Real cross sibling ranges after acceptance: no suggestions and no overlay mutation.
 await page.locator('.topbar [data-mode="suggest"]').click();await page.waitForTimeout(120);await frame.evaluate(()=>{const el=document.querySelector('#target'),last=document.querySelector('#after');el.focus();const r=document.createRange();r.setStart(el.firstChild,0);r.setEnd(last.firstChild,2);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'))});await page.waitForTimeout(120);assert(!await page.locator('#selection-suggest').isVisible()||await page.locator('#selection-suggest').isDisabled());await page.keyboard.insertText('NO');assert.equal((await records()).length,count);assert.deepEqual((await ctx.request.get(base+'/api/doc/list-synthetic').then(r=>r.json())).overlay,final.overlay);assert.equal(await frame.locator('#items>li').count(),3);
 const db=new Database(path.join(dir,'app.db'),{readonly:true});const rows=db.prepare('SELECT anchor,quote,body,range_start,range_end,status,kind FROM suggestions WHERE doc_id=? ORDER BY created_at').all('list-synthetic');db.close();assert.equal(rows.length,2);assert(rows.some(r=>r.kind==='comment'&&r.quote===quote&&r.range_end===quote.length));assert(rows.some(r=>r.kind==='rewrite'&&r.range_start===start&&r.status==='accepted'));
 assert.deepEqual(errors,[]);if(out){await writeFile(out+'/storage-evidence.json',JSON.stringify({anchor,start,end,payloads,rows,originalSourceUnchanged:final.baseHtml===original.baseHtml,overlayOnlyIntendedLi:true,exportListSiblings:3},null,2));await writeFile(out+'/synthetic-reviewed.html',exported)}
 console.log('PASS disposable SQLite: native double→triple stores whole paragraph quote 0..UTF16 length; second local replacement exact offsets; genuine pending lock; owner accept only intended li; source base unchanged, siblings+inline shells preserved; real viewer export independently parsed; true cross-li refused with zero extra records/overlay changes.');
}catch(e){console.error(output);throw e}finally{await browser?.close();if(child){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r))}await rm(dir,{recursive:true,force:true})}
