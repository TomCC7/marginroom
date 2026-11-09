// Real disposable server/database only. No live article, service, or remote host.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import net from 'node:net';
import {launchBrowser} from './helpers/browser.mjs';
const dir=await mkdtemp(path.join(process.env.TMPDIR||tmpdir(),'selection-storage-'));
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const base=`http://127.0.0.1:${port}`,key=randomBytes(32).toString('hex');let child,browser,output='';
try{
 await mkdir(path.join(dir,'docs'));
 child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),HS_DB_PATH:path.join(dir,'app.db'),HS_DOCS_DIR:path.join(dir,'docs'),SESSION_SECRET:randomBytes(32).toString('hex'),OWNER_KEY:key},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 for(let i=0;i<150;i++){try{if((await fetch(base+'/api/whoami')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await launchBrowser();const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
 let submits=0;
 await ctx.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==base)return route.abort();if(route.request().method()==='POST'&&u.pathname==='/api/suggest/mobile-synthetic')submits++;
 if(process.env.SELECTION_PUBLIC&&/^\/[\w.-]+\.(?:js|css|html)$/.test(u.pathname)){
 const assets=['/review-v3.js','/review-v3.css','/viewer.html'].includes(u.pathname)?process.env.SELECTION_PUBLIC:process.env.SELECTION_BASE_PUBLIC;
 if(assets)return route.fulfill({body:await readFile(path.join(assets,u.pathname)),contentType:u.pathname.endsWith('.js')?'text/javascript':u.pathname.endsWith('.css')?'text/css':'text/html'});
 }
 return route.continue()});
 const page=await ctx.newPage();await page.goto(base+'/?key='+key);await page.waitForFunction(()=>!location.search.includes('key='));
 await page.locator('input[type=file]').first().setInputFiles({name:'mobile-synthetic.html',mimeType:'text/html',buffer:Buffer.from('<h1>Synthetic selection</h1><p id="repeat">same same 😀 same same.</p>')});
 await page.waitForURL('**/viewer.html?doc=mobile-synthetic');await page.waitForFunction(()=>document.querySelector('#hs-status')?.textContent.includes('已同步'));
 await page.waitForFunction(()=>document.querySelector('iframe')?.dataset.previewScale);const frame=page.frames()[1];
 await frame.locator('#repeat').evaluate(el=>{const r=document.createRange();r.setStart(el.firstChild,18);r.setEnd(el.firstChild,22);getSelection().removeAllRanges();getSelection().addRange(r)});
 const action=page.locator('#mobile-add-comment');await action.waitFor({state:'visible'});
 await action.dispatchEvent('pointerdown',{pointerType:'touch'});await frame.evaluate(()=>getSelection().removeAllRanges());await page.waitForTimeout(180);await action.dispatchEvent('click');
 assert.equal(await page.locator('#selected-quote').textContent(),'same');await page.locator('#comment-body').fill('Disposable precise quote');
 // Same-event-loop double submission must emit one request.
 await page.locator('#send-comment').evaluate(b=>{b.click();b.click()});await page.waitForFunction(()=>document.querySelector('#composer').hidden);
 const result=await ctx.request.get(base+'/api/suggestions/mobile-synthetic?status=all').then(r=>r.json());
 assert.equal(result.suggestions.length,1);const record=result.suggestions[0];assert.equal(record.quote,'same');assert.equal(record.range_start,18);assert.equal(record.range_end,22);assert.equal(record.body,'Disposable precise quote');assert.equal(submits,1);
 await page.locator('.close-drawer').tap();await frame.locator('.marker').tap();assert.equal(await page.locator('.discussion').isVisible(),true);
 await page.locator('.close-drawer').tap();
 // Existing paragraph suggestion remains protected; selecting it cannot open a comment.
 await page.locator('.dock [data-mode="suggest"]').tap();await frame.waitForFunction(()=>document.querySelector('#repeat').contentEditable==='true');await frame.locator('#repeat').focus();await page.keyboard.press('End');await page.keyboard.insertText(' draft');await page.locator('#draft-actions').waitFor({state:'visible'});
 await frame.locator('#repeat').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r)});await page.waitForTimeout(180);
 assert.equal(await action.isVisible(),false);assert.equal(await page.locator('#draft-actions').isVisible(),true);
 await page.locator('#cancel-draft').click();
 console.log('PASS disposable DB: exact repeated quote + UTF-16 offsets 18..22 after touch/collapse; one POST for double click; existing marker tap; paragraph draft protected.');
}catch(e){console.error(output);throw e}finally{await browser?.close();if(child){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r))}await rm(dir,{recursive:true,force:true})}
