// Native input + genuine DOM Ranges; GET-only isolated fixtures, no server writes.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser,isolate,syntheticFixture,openFixture} from './helpers/browser.mjs';
const out=process.env.LIST_ARTIFACTS,baseline=process.env.LIST_BASELINE==='1',metrics=[];
if(out)await mkdir(out,{recursive:true});
const browser=await launchBrowser();
const text='负载策略从头训练，不以旧空载checkpoint作为初始化。旧文件暂不删除，仅作历史记录；“不需要保留作起点”不等于需要清空磁盘。';
try {
 for(const width of [1440,390]){
 const ctx=await browser.newContext({viewport:{width,height:900},hasTouch:width<600}),fixture=syntheticFixture();
 fixture.doc.baseHtml='<style>body{margin:0;padding:24px;color:#21473f;font:18px/1.8 system-ui}li,p{max-width:640px}</style><h1>Metal Arm · 负载策略</h1><input id="retained" value="initial"><ul id="items"><li id="before">每手独立负载，不做两手共同搬同一个刚体。</li><li id="target">'+text+'</li><li id="rich">😀 same <em>emphasis</em> <strong>bold</strong> <a href="#">link</a> same same.</li><li id="nested"><p id="nested-a">Nested first paragraph.</p><p id="nested-b">Nested second paragraph.</p></li><li id="after">质量范围以官网标称每臂3kg为实验上限。</li></ul><p id="paragraph">'+text+'</p><div data-hs-group><p>Grouped rich first</p><p>Grouped rich second</p></div>';
 const evidence=await isolate(ctx,fixture),page=await ctx.newPage();await openFixture(page);page.setDefaultTimeout(7000);
 await page.waitForFunction(()=>document.querySelector('iframe')?.dataset.previewScale);const frame=page.frames()[1];
 await frame.locator('#retained').fill('same frame input');await page.evaluate(()=>window.savedFrame=document.querySelector('iframe'));
 await page.locator(width<600?'.dock [data-mode="suggest"]':'.topbar [data-mode="suggest"]').click();await frame.waitForFunction(()=>document.querySelector('#target').contentEditable==='true');
 const mode=async(preset,zoom)=>{await page.selectOption('#preview-mode',preset);await page.selectOption('#preview-zoom',zoom);await frame.waitForFunction(p=>p==='auto'||innerWidth===390,preset);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))};
 const select=async(id,start,end)=>frame.locator(id).evaluate((el,{start,end})=>{el.focus();const w=document.createTreeWalker(el,4);let t,pos=0,a,b,ao,bo;while(t=w.nextNode()){if(a===undefined&&pos+t.length>=start){a=t;ao=start-pos}if(pos+t.length>=end){b=t;bo=end-pos;break}pos+=t.length}const r=document.createRange();r.setStart(a,ao);r.setEnd(b,bo);getSelection().removeAllRanges();getSelection().addRange(r)},{start,end});
 const cancel=async()=>{await page.locator('#cancel-draft').click();await frame.waitForFunction(t=>document.querySelector('#target').textContent===t,text)};
 for(const preset of ['auto','phone'])for(const zoom of ['fit','actual']){
  await mode(preset,zoom);
  // Residual native shell selection is the original RED reproduction.
  await page.locator(width<600?'.brand':'#hs-docname').dblclick();await select('#target',0,0);await page.keyboard.insertText('!');
  await page.waitForTimeout(80);
  if(baseline){assert.equal(await page.locator('#draft-actions').isVisible(),false);assert.match(await page.locator('#toast').textContent(),/跨段/);if(out)await page.screenshot({path:`${out}/${width}-false-crossparagraph.png`});break}
  await page.locator('#draft-actions').waitFor({state:'visible'});assert.match(await frame.locator('#target').textContent(),/^!/);
  assert.equal(await page.locator('#toast').textContent(),'');
  if(out)await page.screenshot({path:`${out}/${width}-${preset}-${zoom}-single-li.png`});
  const before=await frame.locator('#retained').inputValue();await page.locator('#preview-dock-toggle').click();await page.locator('#preview-dock-toggle').click();assert(await page.locator('#draft-actions').isVisible());assert.equal(await frame.locator('#retained').inputValue(),before);assert(await page.evaluate(()=>savedFrame===document.querySelector('iframe')));
  metrics.push({width,preset,zoom,singleLiDraft:true});await cancel();
 }
 if(baseline){await ctx.close();continue}
 await mode('auto','fit');
 // Inline markup and repeated UTF-16 text keep their shells during ordinary edits.
 const rich=await frame.locator('#rich').textContent(),at=rich.lastIndexOf('same');await select('#rich',at,at+4);await page.keyboard.insertText('next');await page.locator('#draft-actions').waitFor({state:'visible'});
 assert.equal(await frame.locator('#rich').textContent(),rich.slice(0,at)+'samenext'+rich.slice(at+4)); // tracked deletion + insertion
 assert.equal(await frame.locator('#rich em').textContent(),'emphasis');assert.equal(await frame.locator('#rich strong').textContent(),'bold');assert.equal(await frame.locator('#rich a').textContent(),'link');await page.locator('#cancel-draft').click();
 // Ctrl+A is constrained by the focused contenteditable host.
 await frame.locator('#target').focus();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('replacement');await page.locator('#draft-actions').waitFor({state:'visible'});assert.equal(await frame.locator('#items>li').count(),5);await cancel();
 // A visually wrapped p is still one semantic paragraph; deletion then cancellation.
 await select('#paragraph',1,2);await page.keyboard.press('Backspace');await page.locator('#draft-actions').waitFor({state:'visible'});await page.locator('#cancel-draft').click();
 // Cursor deletion at host edges must not merge siblings.
 for(const [offset,key] of [[0,'Backspace'],[text.length,'Delete']]){await select('#target',offset,offset);await page.keyboard.press(key);assert.equal(await frame.locator('#items>li').count(),5);if(await page.locator('#draft-actions').isVisible())await cancel()}
 // Native paste (plain text only), multiline refused without flattening.
 await select('#target',0,0);await frame.locator('#target').evaluate(el=>{const d=new DataTransfer();d.setData('text/plain','paste');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}))});await page.locator('#draft-actions').waitFor({state:'visible'});await cancel();
 await select('#target',0,0);const original=await frame.locator('#items').innerHTML();await frame.locator('#target').evaluate(el=>{const d=new DataTransfer();d.setData('text/plain','two\nparagraphs');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}))});assert.equal(await frame.locator('#items').innerHTML(),original);
 // Genuine sibling li, nested p and sibling p selections remain refused.
 for(const [a,b] of [['#target','#rich'],['#nested-a','#nested-b'],['#paragraph','[data-hs-group] p']]){
  const before=await frame.locator('body').innerHTML();await frame.evaluate(([a,b])=>{const el=document.querySelector(a),last=document.querySelector(b);el.focus();const r=document.createRange();r.setStart(el.firstChild,0);r.setEnd(last.firstChild,2);getSelection().removeAllRanges();getSelection().addRange(r)},[a,b]);await page.keyboard.insertText('BAD');
  await frame.locator(a).evaluate(el=>{const d=new DataTransfer();d.setData('text/plain','BAD PASTE');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}))});assert.equal(await frame.locator('body').innerHTML(),before);assert.equal(await page.locator('#draft-actions').isVisible(),false);
 }
 // Real CDP composition into the list item (not a fabricated input payload).
 await select('#target',0,0);const cdp=await ctx.newCDPSession(page);await cdp.send('Input.imeSetComposition',{text:'中文',selectionStart:2,selectionEnd:2});await cdp.send('Input.insertText',{text:'中文'});await page.locator('#draft-actions').waitFor({state:'visible'});assert.match(await frame.locator('#target').textContent(),/^中文/);await cancel();
 assert.equal(await frame.locator('[data-hs-group]').getAttribute('contenteditable'),'false');assert.match(await frame.locator('[data-hs-group]').getAttribute('title'),/分组富文本/);
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.writes,[]);await ctx.close();
 }
 if(out)await writeFile(out+'/list-metrics.json',JSON.stringify(metrics,null,2));console.log(baseline?'PASS baseline: actual false crossparagraph toast reproduced with shell Selection + one wrapped li.':'PASS list suggest: 1440/390 Auto/phone Fit/100%, stale shell selection, inline markup, focused select-all, wrapped p, edge deletion, paste/multiline refusal, nested/sibling real crossblock no mutation, CDP IME, frame/input/draft retention; zero server writes.');
}finally{await browser.close()}
