// Synthetic only: Chromium cannot reproduce an iOS native selection callout.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {launchBrowser,isolate,syntheticFixture,openFixture} from './helpers/browser.mjs';
const browser=await launchBrowser(), shots=process.env.SELECTION_SCREENSHOTS;
if(shots)await mkdir(shots,{recursive:true});
async function select(page,start=11,end=15){
 return page.locator('#selection-fixture').evaluate((el,{start,end})=>{const r=document.createRange();r.setStart(el.firstChild,start);r.setEnd(el.firstChild,end);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));return r.toString()},{start,end});
}
try{
 for(const width of [360,390,440,1440]){
 const ctx=await browser.newContext({viewport:{width,height:844},hasTouch:width<600}), fixture=syntheticFixture();
 fixture.doc.baseHtml='<h1>Synthetic selection review</h1><p id="selection-fixture">same same 😀 same same. Select repeated text safely.</p>'+fixture.doc.baseHtml;
 const log=await isolate(ctx,fixture);
 // Optional isolated live candidate assets; APIs still come exclusively from synthetic fixture.
 if(process.env.SELECTION_PUBLIC)await ctx.route('http://frontend.test/*',async(route)=>{
 const u=new URL(route.request().url());if(!/^\/[\w.-]+\.(?:js|css|html)$/.test(u.pathname))return route.fallback();
 const assets=['/review-v3.js','/review-v3.css','/viewer.html'].includes(u.pathname)?process.env.SELECTION_PUBLIC:process.env.SELECTION_BASE_PUBLIC;
 if(!assets)return route.fallback();
 return route.fulfill({body:await readFile(path.join(assets,u.pathname)),contentType:u.pathname.endsWith('.js')?'text/javascript':u.pathname.endsWith('.css')?'text/css':'text/html'});
 });
 const page=await ctx.newPage();await openFixture(page);
 const mobile=width<600, action=page.locator(mobile?'#mobile-add-comment':'#selection-action');
 assert.equal(await page.locator('#mobile-selection').isVisible(),false);
 assert.equal(await page.locator('#selection-action').isVisible(),false);
 assert.equal(await select(page,13,17),'same');await action.waitFor({state:'visible'});
 if(mobile){
 assert.equal(await page.locator('#selection-action').isVisible(),false);
 const b=await action.boundingBox(), dock=await page.locator('.dock').boundingBox();assert.ok(b.y>=dock.y&&b.height>=44);
 // Reserve a native-menu-equivalent rectangle above the selected text; no fake OS screenshot.
 const r=await page.locator('#selection-fixture').boundingBox();assert.ok(b.y>r.y+r.height);
 assert.equal(await page.locator('.dock>.modes').isVisible(),false);
 }
 // Reselection/handle-drag equivalent must replace offsets, including repeated text.
 await select(page,18,22);await page.waitForTimeout(180);
 await page.evaluate(()=>window.scrollBy(0,80));
 if(shots)await page.screenshot({path:path.join(shots,`${width}-selection.png`)});
 // Real touch opens composer; focus collapse must not alter the saved quote.
 if(mobile)await action.tap();else await action.click();
 await page.locator('#comment-body').waitFor({state:'visible'});assert.equal(await page.locator('#selected-quote').textContent(),'same');
 await page.locator('#comment-body').fill('Preserve my synthetic draft');
 await page.waitForTimeout(5200);assert.equal(await page.locator('#comment-body').inputValue(),'Preserve my synthetic draft');
 if(mobile){
 // Synthetic visualViewport shrink + offset, dispatched through production listeners.
 await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:350});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:40});visualViewport.dispatchEvent(new Event('resize'))});
 for(const id of ['#close-composer','#send-comment']){const b=await page.locator(id).boundingBox();assert.ok(b.y>=40&&b.y+b.height<=390,`${id} keyboard bounds ${JSON.stringify(b)}`)}
 }
 if(shots)await page.screenshot({path:path.join(shots,`${width}-composer.png`)});
 await page.locator('#close-composer').click();assert.equal(await page.locator('#composer').isVisible(),false);
 if(mobile)assert.equal(await page.locator('.dock>.modes').isVisible(),true);
 // Explicit pointerdown -> OS selection collapse -> delayed click race.
 await select(page,13,17);await action.waitFor({state:'visible'});
 await action.dispatchEvent('pointerdown',{pointerType:mobile?'touch':'mouse'});
 await page.evaluate(()=>{getSelection().removeAllRanges();document.dispatchEvent(new Event('selectionchange'))});
 await page.waitForTimeout(180);await action.dispatchEvent('click');
 assert.equal(await page.locator('#selected-quote').textContent(),'same');
 await page.locator('#cancel-comment').click();
 await select(page,13,17);await action.waitFor({state:'visible'});
 if(mobile){await page.locator('#cancel-selection').tap();assert.equal(await action.isVisible(),false)}else{assert.equal(await page.locator('.header-tools .modes').isVisible(),true);assert.equal(await page.locator('.header-tools .show-discussion').isVisible(),true);assert.equal(await page.locator('.nav').evaluate(e=>getComputedStyle(e).position),'sticky');}
 await page.evaluate(()=>getSelection().removeAllRanges());await page.waitForTimeout(180);assert.equal(await action.isVisible(),false);
 await page.locator('#share-btn').click();assert.equal(await page.locator('#composer').isVisible(),false);
 await page.locator('#more-btn').click();assert.equal(await page.locator('#composer').isVisible(),false);
 assert.deepEqual(log.errors,[]);assert.deepEqual(log.writes,[]);await ctx.close();
 }
 console.log('PASS selection: 360/390/440/1440, native-callout reserved space, touch, repeated quote reselection, collapse race, cancel/no phantom, composer draft/poll protection, visualViewport keyboard controls, desktop header/sticky nav, no writes or browser errors. Physical iPhone menu pending.');
}finally{await browser.close()}
