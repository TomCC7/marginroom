// Real detail=2 -> detail=3 native clicks, both rendering paths. No production API.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser,isolate,syntheticFixture,openFixture} from './helpers/browser.mjs';
const browser=await launchBrowser(),out=process.env.TRIPLE_ARTIFACTS,baseline=process.env.TRIPLE_BASELINE==='1',metrics=[];
if(out)await mkdir(out,{recursive:true});
try{
 for(const plain of [false,true])for(const width of [1440,390]){
 const ctx=await browser.newContext({viewport:{width,height:900},hasTouch:width<600}),fixture=syntheticFixture();
 fixture.doc.baseHtml='<style>li,p{font:18px/1.8 system-ui;max-width:600px}body{margin:0;padding:24px}</style><h1>原生整段选区 · Metal Arm</h1><ul><li>before</li>\n  <li id="target">same local 😀 same local. '+ 'Wrapped paragraph text for review. '.repeat(4)+'</li>\n  <li id="after">after</li></ul><p id="paragraph">same local 😀 same local. '+ 'Wrapped paragraph text for review. '.repeat(4)+'</p><p id="last">last</p>';
 const evidence=await isolate(ctx,fixture);
 if(plain)await ctx.route('**/preview-viewport.js',r=>r.fulfill({contentType:'text/javascript',body:'export function initPreview(){}'}));
 const page=await ctx.newPage();await openFixture(page);page.setDefaultTimeout(7000);
 if(!plain)await page.waitForFunction(()=>document.querySelector('iframe')?.dataset.previewScale);
 const doc=plain?page:page.frames()[1],action=page.locator(width<600?'#mobile-add-comment':'#selection-action');
 const point=async(id,start,end)=>{const pos=await doc.locator(id).evaluate((el,{start,end})=>{const r=document.createRange();r.setStart(el.firstChild,start);r.setEnd(el.firstChild,end);const b=r.getBoundingClientRect();return {x:b.x+5,y:b.y+8}},{start,end});if(plain)return pos;const b=await page.locator('iframe').boundingBox(),scale=await page.locator('iframe').evaluate(n=>+n.dataset.previewScale);return {x:b.x+pos.x*scale,y:b.y+pos.y*scale}};
 const select=async(id,start,end)=>doc.locator(id).evaluate((el,{start,end})=>{el.tabIndex=-1;el.focus({preventScroll:true});const r=document.createRange();r.setStart(el.firstChild,start);r.setEnd(el.firstChild,end);getSelection().removeAllRanges();getSelection().addRange(r)},{start,end});
 const close=async()=>{await page.locator('#cancel-comment').click();await doc.evaluate(()=>getSelection().removeAllRanges())};
 for(const id of ['#target','#paragraph'])for(const zoom of plain?['native']:['fit','actual']){
  if(!plain){await page.selectOption('#preview-mode','phone');await page.selectOption('#preview-zoom',zoom);await doc.waitForFunction(()=>innerWidth===390);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))}
  await page.evaluate(()=>{scrollTo(0,0);document.querySelector('#article').scrollTo(0,0)});await doc.locator(id).evaluate(n=>n.scrollIntoView({block:'center'}));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
  const {x,y}=await point(id,5,10);await page.mouse.click(x,y,{clickCount:2});await action.waitFor({state:'visible'});assert.equal(await doc.evaluate(()=>getSelection().toString()),'local');
  await page.mouse.click(x,y,{clickCount:3});const range=await doc.evaluate(()=>{const s=getSelection(),r=s.getRangeAt(0);return {quote:s.toString(),start:r.startOffset,end:r.endOffset,endNode:r.endContainer.nodeName}});
  assert.match(range.quote,/Wrapped paragraph/);await action.click();await page.locator('#composer').waitFor({state:'visible'});
  const actual=await page.locator('#selected-quote').textContent(),expected=await doc.locator(id).textContent();metrics.push({plain,width,id,zoom,native:range,actual,expected});
  if(out)await page.screenshot({path:`${out}/${plain?'ordinary':'iframe'}-${width}-${id.slice(1)}-${zoom}.png`});
  if(baseline){assert.equal(actual,'local');await close();break}
  assert.equal(actual,expected);await close();
  // Double word remains normal, then rapid second-occurrence reselection uses UTF16.
  await select(id,5,10);await action.waitFor({state:'visible'});await action.click();assert.equal(await page.locator('#selected-quote').textContent(),'local');await close();
  await select(id,5,10);await action.waitFor({state:'visible'});await select(id,19,24);await action.dispatchEvent('pointerdown',{pointerType:width<600?'touch':'mouse'});await action.dispatchEvent('click');await page.locator('#composer').waitFor({state:'visible'});assert.equal(await page.locator('#selected-quote').textContent(),'local');await close();
  // Keyboard extension, then immediate activation without waiting a debounce.
  await page.locator(width<600?'.dock [data-mode="suggest"]':'.topbar [data-mode="suggest"]').click();await doc.waitForFunction(()=>document.querySelector('#target').contentEditable==='true');
  await select(id,5,5);await page.keyboard.press('ControlOrMeta+Shift+ArrowRight');await action.waitFor({state:'visible'});const keyboardQuote=await doc.evaluate(()=>getSelection().toString());await action.click();assert.equal(await page.locator('#selected-quote').textContent(),keyboardQuote);await close();
  await page.locator(width<600?'.dock [data-mode="read"]':'.topbar [data-mode="read"]').click();
  // A real crossblock range invalidates an earlier word, not stale fallback.
  await select(id,5,10);await action.waitFor({state:'visible'});await doc.evaluate(id=>{const r=document.createRange();r.setStart(document.querySelector(id).firstChild,0);r.setEnd(document.querySelector(id==='#target'?'#after':'#last').firstChild,2);getSelection().removeAllRanges();getSelection().addRange(r)},id);await action.dispatchEvent('pointerdown');await action.dispatchEvent('click');await page.waitForTimeout(40);assert.equal(await page.locator('#composer').isVisible(),false);await doc.evaluate(()=>getSelection().removeAllRanges());
 }
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.writes,[]);await ctx.close();
 }
 if(out)await writeFile(out+'/triple-metrics.json',JSON.stringify(metrics,null,2));console.log(baseline?'PASS baseline: native triple selection whole paragraph, composer stale double-click local.':'PASS native triple: ordinary + sandbox iframe, li/p, 1440/390, Fit/100%, immediate whole-paragraph snapshot, double word, rapid repeated UTF16 reselection, keyboard, crossblock invalidation; zero writes.');
}finally{await browser.close()}
