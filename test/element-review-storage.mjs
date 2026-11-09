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
import {dashboard} from './fixtures/review-dashboard.mjs';
const dir=await mkdtemp(path.join(process.env.TMPDIR||tmpdir(),'element-review-')),out=process.env.STORAGE_ARTIFACTS;
if(out)await mkdir(out,{recursive:true});
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const base=`http://127.0.0.1:${port}`,key=randomBytes(32).toString('hex');let child,browser,output='';
try{
 await mkdir(path.join(dir,'docs'));child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),HS_DB_PATH:path.join(dir,'app.db'),HS_DOCS_DIR:path.join(dir,'docs'),SESSION_SECRET:randomBytes(32).toString('hex'),OWNER_KEY:key},stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 for(let i=0;i<150;i++){try{if((await fetch(base+'/api/whoami')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await launchBrowser();const ctx=await browser.newContext({viewport:{width:1440,height:900}}),errors=[];ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await ctx.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 const page=await ctx.newPage();await page.goto(base+'/?key='+key);await page.waitForFunction(()=>!location.search.includes('key='));
 const allEvidence=[];
 const upload=async(name,html)=>{await page.goto(base+'/');await page.locator('input[type=file]').first().setInputFiles({name:name+'.html',mimeType:'text/html',buffer:Buffer.from(html)});await page.waitForURL('**/viewer.html?doc='+name);await page.waitForFunction(()=>document.querySelector('#hs-status')?.textContent.includes('已同步'));await page.waitForFunction(()=>document.querySelector('iframe')?.dataset.previewScale);await page.waitForTimeout(400);return page.frames()[1]};
 for(const interactive of [true,false]){
  const name=interactive?'dashboard':'static-dashboard',html=interactive?dashboard:dashboard.replace(/<script>[\s\S]*?<\/script>/,'');let frame=await upload(name,html);
  const records=()=>ctx.request.get(base+'/api/suggestions/'+name+'?status=all').then(r=>r.json()).then(j=>j.suggestions),documentData=()=>ctx.request.get(base+'/api/doc/'+name).then(r=>r.json()),original=await documentData();
  if(interactive){await frame.locator('#generate').click();await frame.waitForSelector('#dynamic')}
  await page.locator('.topbar [data-mode="suggest"]').click();await page.waitForTimeout(120);
  const storedTargets={};
  for(const id of ['launch','image','setup','card',...(interactive?['dynamic']:[])]){
   // Select card by its actual empty padding, not a text descendant.
   if(id==='setup'){const b=await frame.locator('#setup').boundingBox();await page.mouse.click(b.x+b.width-8,b.y+8)}else await frame.locator('#'+id).click();
   await page.waitForTimeout(400);assert.match(await page.locator('#target-label').textContent(),new RegExp('#'+id));
   await page.locator('#selection-action').click();await page.locator('#comment-body').fill('Comment on '+id);await page.locator('#send-comment').click();await page.waitForFunction(()=>document.querySelector('#composer').hidden);
   const rows=await records(),row=rows.find(r=>r.body==='Comment on '+id);assert(row);assert.match(row.anchor,/^c2:[a-f0-9]{64}$/);storedTargets[id]=row;
  }
  assert.equal((await records()).length,Object.keys(storedTargets).length);assert.deepEqual((await documentData()).overlay,original.overlay);assert.equal((await documentData()).baseHtml,original.baseHtml);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#hs-status')?.textContent.includes('已同步'));await page.waitForTimeout(500);frame=page.frames()[1];
  if(interactive){await frame.locator('#generate').click();await frame.waitForSelector('#dynamic')}
  // Reorder stable-identity target; anchor must follow it, not original sibling.
  await frame.locator('#launch').evaluate(el=>el.parentElement.append(el));
  for(const id of Object.keys(storedTargets)){
   await page.locator(`[data-locate="${storedTargets[id].id}"]`).click();await page.waitForTimeout(150);
   const actual=await frame.locator('#'+id).boundingBox(),outline=await frame.locator('[data-review-overlay]').boundingBox();assert(actual&&outline,JSON.stringify({interactive,id,actual,outline,thread:await page.locator('#thread-'+storedTargets[id].id).textContent()}));assert(Math.abs(actual.x-outline.x)<2&&Math.abs(actual.y-outline.y)<2,id+' points to actual reloaded target');
  }
  // Reply draft and panel toggles must not lose typed text or retarget composer.
  await page.locator(`[data-reply="${storedTargets.launch.id}"]`).click();await page.locator('#comment-body').fill('Persistent reply');await page.locator('.show-discussion').dispatchEvent('click');assert.equal(await page.locator('#comment-body').inputValue(),'Persistent reply');await page.locator('#send-comment').click();await page.waitForFunction(()=>document.querySelector('#composer').hidden);assert.equal((await records()).find(r=>r.id===storedTargets.launch.id).replies[0].body,'Persistent reply');
  // Removed target -> explicit missing, thread still readable/replyable.
  await frame.locator('#image').evaluate(el=>el.remove());await page.locator(`[data-locate="${storedTargets.image.id}"]`).click();await page.waitForTimeout(200);assert.match(await page.locator('#thread-'+storedTargets.image.id).textContent(),/无法安全定位/);
  // Fit ~50% and 100% stage/nested scroll ownership.
  await page.selectOption('#preview-mode','desktop');await page.selectOption('#preview-zoom','fit');await page.waitForTimeout(250);const outer=await page.evaluate(()=>scrollY);await page.locator(`[data-locate="${storedTargets.launch.id}"]`).click();await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>scrollY),outer);
  await page.selectOption('#preview-zoom','actual');await page.waitForTimeout(150);await page.locator('#article').evaluate(n=>{n.scrollLeft=200;n.scrollTop=100});await page.locator(`[data-locate="${storedTargets.launch.id}"]`).click();await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>scrollY),outer);
  if(!interactive){
   await page.selectOption('#preview-mode','auto');await page.selectOption('#preview-zoom','fit');await page.locator('.topbar [data-mode="suggest"]').click();await page.waitForTimeout(120);
   const quote=await frame.locator('#item').textContent(),start=quote.lastIndexOf('local'),end=start+5;
   const select=async(a,b)=>frame.locator('#item').evaluate((el,{a,b})=>{const r=document.createRange();r.setStart(el.firstChild,a);r.setEnd(el.firstChild,b);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'))},{a,b});
   await select(start,end);await page.locator('#selection-suggest').waitFor({state:'visible'});assert(await page.locator('#selection-suggest').isEnabled());await page.locator('#selection-suggest').click();await page.locator('#comment-body').fill('replacement');await page.locator('#send-comment').click();await page.waitForFunction(()=>document.querySelector('#composer').hidden);
   const rewrite=(await records()).find(r=>r.kind==='rewrite');assert(rewrite);assert.equal(rewrite.quote,'local');assert.equal(rewrite.range_start,start);assert.equal(rewrite.range_end,end);assert.equal(rewrite.base_text,quote);
   await page.locator(`[data-accept="${rewrite.id}"]`).click();await page.waitForFunction(()=>document.querySelector('#hs-status').textContent.includes('已接受修改'));frame=page.frames()[1];await frame.waitForFunction(t=>document.querySelector('#item').textContent===t,quote.slice(0,start)+'replacement'+quote.slice(end));assert.equal(await frame.locator('#sibling').textContent(),'Untouched sibling.');
   // Crossblock selection never offers a functioning replacement.
   const before=await documentData(),count=(await records()).length;await page.locator('.topbar [data-mode="suggest"]').click();await frame.evaluate(()=>{const a=document.querySelector('#item'),b=document.querySelector('#sibling'),r=document.createRange();r.setStart(a.firstChild,0);r.setEnd(b.firstChild,3);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'))});await page.waitForTimeout(100);assert(!await page.locator('#selection-suggest').isVisible()||await page.locator('#selection-suggest').isDisabled());assert.equal((await records()).length,count);assert.deepEqual((await documentData()).overlay,before.overlay);
  }
  allEvidence.push({name,targets:Object.fromEntries(Object.entries(storedTargets).map(([k,v])=>[k,{id:v.id,anchor:v.anchor}])),records:await records(),sourceUnchanged:(await documentData()).baseHtml===original.baseHtml});
 }
 const db=new Database(path.join(dir,'app.db'),{readonly:true}),rows=db.prepare('SELECT doc_id,anchor,quote,kind,status,range_start,range_end FROM suggestions').all();db.close();assert.equal(rows.length,10);assert.equal(rows.filter(r=>r.kind==='rewrite'&&r.status==='accepted').length,1);assert.deepEqual(errors,[]);if(out)await writeFile(out+'/element-storage.json',JSON.stringify({allEvidence,rows},null,2));
 console.log('PASS disposable SQLite: 9 c2 element comments button/img/card/runtime across static+interactive, reload/reorder exact target, removed target missing, reply persistence, Fit/100% stage scroll owners, explicit selected-li UTF16 suggestion + owner acceptance, source/siblings preserved, crossblock refused.');
}catch(e){console.error(output);throw e}finally{await browser?.close();if(child){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r))}await rm(dir,{recursive:true,force:true})}
