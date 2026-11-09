// Real disposable SQLite/import pipeline; never connects to a live document.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import net from 'node:net';
import {launchBrowser} from './helpers/browser.mjs';
const dir=await mkdtemp(path.join(process.env.TMPDIR||tmpdir(),'viewport-storage-'));
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const base=`http://127.0.0.1:${port}`,key=randomBytes(32).toString('hex');let child,browser,output='';
try{
 await mkdir(path.join(dir,'docs'));
 child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),HS_DB_PATH:path.join(dir,'app.db'),HS_DOCS_DIR:path.join(dir,'docs'),SESSION_SECRET:randomBytes(32).toString('hex'),OWNER_KEY:key},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 for(let i=0;i<150;i++){try{if((await fetch(base+'/api/whoami')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await launchBrowser();const ctx=await browser.newContext({viewport:{width:1440,height:1000}});let submits=0;
 await ctx.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==base)return route.abort();if(route.request().method()==='POST'&&u.pathname==='/api/suggest/viewport-synthetic')submits++;return route.continue()});
 const page=await ctx.newPage();await page.goto(base+'/?key='+key);await page.waitForFunction(()=>!location.search.includes('key='));
 await page.locator('input[type=file]').first().setInputFiles({name:'viewport-synthetic.html',mimeType:'text/html',buffer:Buffer.from('<style>body{margin:0}p{width:800px;padding:20px}#nested{height:180px;overflow:auto}</style><h1>Viewport storage</h1><input id="form" value="initial"><div style="height:1000px"></div><div id="nested"><div style="height:400px"></div><p id="repeat">same same 😀 same same.</p><div style="height:500px"></div></div><div style="height:1000px"></div>')});
 await page.waitForURL('**/viewer.html?doc=viewport-synthetic');await page.waitForFunction(()=>document.querySelector('#hs-status')?.textContent.includes('已同步'));
 await page.selectOption('#preview-mode','auto');await page.waitForFunction(()=>document.querySelector('iframe')?.dataset.previewScale);
 const frame=page.frames()[1];const anchor=await frame.locator('#repeat').getAttribute('data-hs-anchor');
 await frame.locator('#form').fill('auto input');await page.selectOption('#preview-mode','desktop');await page.waitForFunction(()=>document.body.classList.contains('preview-device'));
 await frame.waitForFunction(()=>innerWidth===1440);
 assert.equal(await frame.locator('#form').inputValue(),'auto input');await frame.locator('#form').fill('device input');
 await page.locator('.topbar [data-mode="suggest"]').click();for(const zoom of ['fit','actual']){
  await page.selectOption('#preview-zoom',zoom);
  await frame.evaluate(()=>{const el=document.querySelector('#repeat');document.querySelector('#nested').scrollTop=400;scrollTo(0,800);const r=document.createRange(),walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n,offset=0,start=false;while(n=walker.nextNode()){if(n.parentElement.closest('[data-review-point],[data-review-ins]'))continue;if(!start&&offset+n.length>=18){r.setStart(n,18-offset);start=true}if(offset+n.length>=22){r.setEnd(n,22-offset);break}offset+=n.length}getSelection().removeAllRanges();getSelection().addRange(r)});
  if(zoom==='actual')await page.evaluate(()=>document.querySelector('#article').scrollTo(200,150));
  await page.locator('#selection-action').waitFor({state:'visible'});
  const action=await page.locator('#selection-action').boundingBox();assert(action.x>=0&&action.y>=0&&action.x+action.width<=1441);
  await page.locator('#selection-action').click();assert.equal(await page.locator('#selected-quote').textContent(),'same');await page.locator('#comment-body').fill('Precise '+zoom);await page.locator('#send-comment').click();await page.waitForFunction(()=>document.querySelector('#composer').hidden);
  const result=await ctx.request.get(base+'/api/suggestions/viewport-synthetic?status=all').then(r=>r.json()),record=result.suggestions.find(s=>s.body==='Precise '+zoom);
  assert(record);assert.equal(record.anchor,anchor);assert.equal(record.quote,'same');assert.equal(record.range_start,18);assert.equal(record.range_end,22);
  // Deliberately move both scroll owners away before locating the stored thread.
  const outer=await page.evaluate(()=>scrollY);
  await frame.evaluate(()=>{scrollTo(0,0);document.querySelector('#nested').scrollTop=0});await page.locator(`[data-locate="${record.id}"]`).click();
  await frame.waitForFunction(()=>document.querySelector('#nested').scrollTop>0&&scrollY>0);
  await frame.waitForFunction(()=>!!document.querySelector('.record-focus'));
  assert.equal(await page.evaluate(()=>scrollY),outer,'inline thread navigation must not scroll shell');
  await page.locator('[data-view="list"]').click();await frame.evaluate(()=>{scrollTo(0,0);document.querySelector('#nested').scrollTop=0});await page.locator(`[data-record="${record.id}"]`).click();
  await frame.waitForFunction(()=>document.querySelector('#nested').scrollTop>0&&scrollY>0);
  await page.waitForFunction(()=>!document.body.classList.contains('list-view'));
  assert.equal(await page.evaluate(()=>scrollY),0,'list-to-passage must retain top-level scroll');
 }
 assert.equal(submits,2);
 await page.selectOption('#preview-mode','auto');await page.waitForFunction(()=>document.querySelector('iframe')?.dataset.previewScale);assert.equal(await frame.locator('#form').inputValue(),'device input');assert.equal(await frame.locator('#repeat').getAttribute('data-hs-anchor'),anchor);
 const guest=await browser.newContext({viewport:{width:390,height:844}}),g=await guest.newPage();await g.goto(base+'/viewer.html?doc=viewport-synthetic');await g.waitForFunction(()=>document.querySelector('#hs-status')?.textContent.includes('已同步'));await g.locator('#more-btn').click();assert.equal(await g.locator('#direct-edit-menu').count(),0);await g.keyboard.press('Escape');
 await page.selectOption('#preview-mode','desktop');await page.waitForFunction(()=>document.body.classList.contains('preview-device'));await page.locator('.topbar [data-mode="suggest"]').click();
 await frame.locator('#repeat').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'))});await page.locator('#selection-suggest').click();await page.locator('#comment-body').fill('same same 😀 same same. accepted');
 for(const preset of ['phone','auto','desktop']){await page.locator('#preview-mode').evaluate((n,value)=>{n.value=value;n.dispatchEvent(new Event('change'))},preset);assert.equal(await page.locator('#comment-body').inputValue(),'same same 😀 same same. accepted')}
 await page.locator('#send-comment').click();await page.waitForFunction(()=>document.querySelector('#composer').hidden);
 const changes=await ctx.request.get(base+'/api/suggestions/viewport-synthetic?status=all').then(r=>r.json()),rewrite=changes.suggestions.find(s=>s.kind==='rewrite');assert(rewrite);await page.locator(`[data-accept="${rewrite.id}"]`).click();
 await page.waitForFunction(()=>document.querySelector('#hs-status').textContent.includes('已接受修改'));const acceptedFrame=page.frames().find(f=>f!==page.mainFrame());assert(acceptedFrame);await acceptedFrame.waitForFunction(()=>document.querySelector('#repeat').textContent.includes('accepted'));assert.equal(await acceptedFrame.locator('#repeat').getAttribute('data-hs-anchor'),anchor);
 await g.selectOption('#preview-mode','phone');await g.waitForFunction(()=>document.body.classList.contains('preview-device'));assert.equal(await g.frames()[1].locator('#repeat').getAttribute('contenteditable'),'false'); // Read mode is locked inside the static sandbox too.
 await guest.close();
 console.log('PASS disposable SQLite: source import, stable storage anchor, exact repeated UTF-16 offsets 18..22 at Fit and 100% with inner/nested scroll and stage pan; stored-thread navigation owns frame/nested scroll; form and unsent suggestion survive Auto/presets; real suggestion submit+owner accept reconnects correct anchor; guest direct-edit control remains restricted.');
}catch(e){console.error(output);throw e}finally{await browser?.close();if(child){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r))}await rm(dir,{recursive:true,force:true})}
