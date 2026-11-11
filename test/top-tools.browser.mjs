// GET-only synthetic Chromium regression. Never starts a service or contacts live.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser,isolate,syntheticFixture,openFixture} from './helpers/browser.mjs';
const out=process.env.TOP_TOOLS_ARTIFACTS||'review-artifacts/top-tools/verification';await mkdir(out,{recursive:true});
const browser=await launchBrowser(),metrics=[];
const text='Alpha saved revision text for viewport preservation.';
const html=`<style>body{margin:0;font:18px/1.8 system-ui}main{padding:20px}footer{position:fixed;bottom:0;background:#dceee1;width:100%}input{max-width:100%}</style><main><h1>Viewport tools</h1><input id="input" value="initial"><div style="height:700px"></div><p id="target" data-hs-anchor="target">${text}</p>${'<p>Reading passage 保留阅读位置。</p>'.repeat(80)}</main><footer>Source footer · visible</footer>`;
try{for(const width of [1440,1024,390,360]){
 const ctx=await browser.newContext({viewport:{width,height:900}}),fixture=syntheticFixture();fixture.doc.baseHtml=html;
 const ev=await isolate(ctx,fixture);
 // Explicit revision capability fixture, not a response from a live service.
 await ctx.route('**/api/revision/synthetic?*',r=>r.fulfill({json:{anchor:'target',baseText:text,proposedText:text.replace('saved','SAVED'),version:'fixture-version',sourceHash:'fixture-hash',records:[]}}));
 await ctx.addInitScript(()=>{if(window===top){window.loads=0;document.addEventListener('load',e=>{if(e.target.tagName==='IFRAME')loads++},true)}});
 const page=await ctx.newPage();page.setDefaultTimeout(8000);await openFixture(page);await page.waitForFunction(()=>document.querySelector('iframe')?.dataset.previewScale);
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
 const trigger=page.locator('#preview-dock-toggle');assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#preview-toggle-slot').count(),0);assert.equal(await page.locator('.topbar #preview-controls').count(),1);
 await page.evaluate(()=>window.identity=document.querySelector('iframe'));const frame=page.frames()[1];await frame.locator('#input').fill('retained input');await frame.evaluate(()=>scrollTo(0,500));const readY=await frame.evaluate(()=>scrollY);assert(readY>0);
 const closed=await page.locator('#article').evaluate(n=>n.clientHeight),box=await trigger.boundingBox();
 const toggle=async()=>{const box=await trigger.boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);await settle();assert.deepEqual(await trigger.boundingBox(),box);assert.equal(await page.evaluate(()=>identity===document.querySelector('iframe')&&loads===1),true)};
 await toggle();assert.equal(await trigger.getAttribute('aria-expanded'),'true');const opened=await page.locator('#article').evaluate(n=>n.clientHeight);assert(closed>opened);assert.equal(await frame.evaluate(()=>scrollY),readY);await page.screenshot({path:`${out}/${width}-open.png`});
 // All presets, real iframe dimensions, rotate, custom, zoom, Fit/100%.
 for(const [mode,w,h] of [['desktop',1440,900],['laptop',1366,768],['tablet',768,1024],['phone',390,844]]){await page.selectOption('#preview-mode',mode);await frame.waitForFunction(([w,h])=>innerWidth===w&&innerHeight===h,[w,h])}
 await page.locator('#preview-rotate').click();await frame.waitForFunction(()=>innerWidth===844&&innerHeight===390);
 await page.selectOption('#preview-mode','custom');await page.locator('#preview-width').fill('980');await page.locator('#preview-height').fill('740');await page.locator('#preview-custom button').click();await frame.waitForFunction(()=>innerWidth===980&&innerHeight===740);
 await page.screenshot({path:`${out}/${width}-custom.png`});
 for(const zoom of ['50','75','125','150','200','actual','fit']){await page.selectOption('#preview-zoom',zoom);await settle();assert.deepEqual(await frame.evaluate(()=>[innerWidth,innerHeight]),[980,740]);if(zoom!=='fit')assert.equal(Number(await page.locator('iframe').getAttribute('data-preview-scale')),zoom==='actual'?1:Number(zoom)/100)}
 // Keyboard boundary resize remains attached to the original stage.
 await page.locator('#preview-resize').focus();await page.keyboard.press('Shift+ArrowRight');await frame.waitForFunction(()=>innerWidth===1030);await page.keyboard.press('Enter');assert(await page.locator('#preview-width').evaluate(n=>n===document.activeElement));
 await page.selectOption('#preview-zoom','200');await settle();await page.locator('#article').evaluate(n=>n.scrollTo(160,120));await frame.evaluate(()=>scrollTo(0,480));const pan=await page.locator('#article').evaluate(n=>[n.scrollLeft,n.scrollTop]);assert(pan[0]>0&&pan[1]>0);const reading=await frame.evaluate(()=>scrollY),pref=await page.evaluate(()=>localStorage.getItem('marginroom.preview.v1:synthetic'));
 await toggle();await toggle();assert.deepEqual(await page.locator('#article').evaluate(n=>[n.scrollLeft,n.scrollTop]),pan);assert.equal(await frame.evaluate(()=>scrollY),reading);assert.equal(await frame.locator('#input').inputValue(),'retained input');assert.equal(await page.evaluate(()=>localStorage.getItem('marginroom.preview.v1:synthetic')),pref);
 await page.selectOption('#preview-zoom','fit');await page.selectOption('#preview-mode','auto');await settle();await toggle();
 // Real inline revision entry using the existing controller, including IME events.
 await page.locator(width<600?'.dock [data-mode=suggest]':'.topbar [data-mode=suggest]').click();await frame.locator('#target').evaluate(n=>{n.scrollIntoView({block:'center'});getSelection().removeAllRanges()});await frame.locator('#target').dispatchEvent('keydown',{key:'Enter'});await page.locator('#selection-suggest').click();await frame.locator('[data-inline-editor]').waitFor();
 const editor=await frame.locator('[data-inline-editor]').elementHandle();const body=()=>editor.evaluate(n=>{const c=n.cloneNode(true);c.querySelectorAll('[data-inline-old],[data-inline-foreign]').forEach(n=>n.remove());return c.textContent});assert.match(await body(),/SAVED/);await page.keyboard.insertText(' 未提交');await page.waitForTimeout(200);const draft=await body();await editor.dispatchEvent('compositionstart',{data:''});await editor.dispatchEvent('compositionupdate',{data:'拼音'});
 const beforeDraft=await frame.evaluate(()=>scrollY);await toggle();await toggle();assert.equal(await body(),draft);assert.equal(await frame.evaluate(()=>scrollY),beforeDraft);assert(await editor.evaluate(n=>n.isConnected));await editor.dispatchEvent('compositionend',{data:'拼音'});await page.screenshot({path:`${out}/${width}-draft.png`});
 await page.locator('#cancel-draft').click();await frame.waitForFunction(()=>!document.querySelector('[data-inline-editor]'));
 // Existing comment composer draft is also untouched; use native element context.
 await frame.locator('#target').dispatchEvent('keydown',{key:'Enter'});await page.locator('#selection-action').click();await page.locator('#comment-body').fill('unsent comment');await toggle();await toggle();assert.equal(await page.locator('#comment-body').inputValue(),'unsent comment');
 // Close modal without submitting or writing fixture data.
 await page.locator('#cancel-comment').click();if(await page.locator('#leave-dialog').isVisible())await page.locator('#leave-discard').click();
 await page.locator(width<600?'.dock [data-mode=read]':'.topbar [data-mode=read]').click();await frame.evaluate(()=>scrollTo(0,500));
 await page.screenshot({path:`${out}/${width}-closed.png`});
 const footer=await frame.locator('footer').boundingBox(),fb=await page.locator('iframe').boundingBox();assert(footer&&fb);assert(Math.abs(footer.y+footer.height-(fb.y+fb.height))<2,'source fixed footer is in visible stage');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);assert.equal(await page.locator('#article').evaluate(n=>Math.round(n.getBoundingClientRect().bottom)),width<600?822:892);assert.equal(await page.locator('.dock').isVisible(),width<600);
 await trigger.focus();await page.keyboard.press('Enter');assert.equal(await trigger.getAttribute('aria-expanded'),'true');await page.keyboard.press('Space');assert.equal(await trigger.getAttribute('aria-expanded'),'false');
 await page.reload();await page.waitForFunction(()=>document.querySelector('iframe')?.dataset.previewScale);assert.equal(await trigger.getAttribute('aria-expanded'),'false');await trigger.click();await page.reload();await page.waitForFunction(()=>document.querySelector('iframe')?.dataset.previewScale);assert.equal(await trigger.getAttribute('aria-expanded'),'true');
 assert.deepEqual(ev.errors,[]);assert.deepEqual(ev.writes,[]);metrics.push({width,closed,opened,recovered:closed-opened,readY,pan,loadsBeforeReload:1,errors:ev.errors,writes:ev.writes});await ctx.close();
}await writeFile(out+'/metrics.json',JSON.stringify(metrics,null,2));console.log('PASS four viewport sizes: same-coordinate toggles, reclaimed stage, controls, footer, nonzero reading/pan, iframe/input/revision/IME/comment drafts, keyboard/persistence, zero network writes.');}finally{await browser.close()}
