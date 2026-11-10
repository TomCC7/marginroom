// Explicit inline projection; native input never commits the canonical source.
// GET-only isolated fixture: no source/server writes or relaxed safety assertions.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser,isolate,syntheticFixture,openFixture} from './helpers/browser.mjs';
const out=process.env.LIST_ARTIFACTS,metrics=[];
if(out)await mkdir(out,{recursive:true});
const browser=await launchBrowser();
const text='负载策略从头训练，不以旧空载checkpoint作为初始化。旧文件暂不删除，仅作历史记录；“不需要保留作起点”不等于需要清空磁盘。';
try{
 for(const width of [1440,390]){
  const ctx=await browser.newContext({viewport:{width,height:900},hasTouch:width<600}),fixture=syntheticFixture();
  fixture.doc.baseHtml='<style>body{margin:0;padding:24px;color:#21473f;font:18px/1.8 system-ui}li,p{max-width:640px}</style><h1>Metal Arm · 负载策略</h1><input id="retained" value="initial"><ul id="items"><li id="before">每手独立负载，不做两手共同搬同一个刚体。</li><li id="target">'+text+'</li><li id="rich">😀 same <em>emphasis</em> <strong>bold</strong> <a href="#">link</a> same same.</li><li id="nested"><p id="nested-a">Nested first paragraph.</p><p id="nested-b">Nested second paragraph.</p></li><li id="after">质量范围以官网标称每臂3kg为实验上限。</li></ul><p id="paragraph">'+text+'</p><div data-hs-group><p>Grouped rich first</p><p>Grouped rich second</p></div>';
  const evidence=await isolate(ctx,fixture),page=await ctx.newPage();await openFixture(page);page.setDefaultTimeout(7000);
  await page.waitForFunction(()=>document.querySelector('iframe')?.dataset.previewScale);const frame=page.frames()[1];
  await frame.locator('#retained').fill('same frame input');await page.evaluate(()=>window.savedFrame=document.querySelector('iframe'));
  await page.locator(width<600?'.dock [data-mode="suggest"]':'.topbar [data-mode="suggest"]').click();await page.waitForTimeout(120);
  assert.notEqual(await frame.locator('#target').getAttribute('contenteditable'),'true');
  const action=page.locator(width<600?'#mobile-suggest':'#selection-suggest');
  const mode=async(preset,zoom)=>{await page.selectOption('#preview-mode',preset);await page.selectOption('#preview-zoom',zoom);await frame.waitForFunction(p=>p==='auto'||innerWidth===390,preset);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))};
  const select=async(id,start,end)=>{await frame.locator(id).evaluate((el,{start,end})=>{const w=document.createTreeWalker(el,4);let t,pos=0,a,b,ao,bo;while(t=w.nextNode()){if(a===undefined&&pos+t.length>=start){a=t;ao=start-pos}if(pos+t.length>=end){b=t;bo=end-pos;break}pos+=t.length}const r=document.createRange();r.setStart(a,ao);r.setEnd(b,bo);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'))},{start,end});await page.waitForTimeout(100)};
  const cancel=async()=>{await page.locator('#cancel-draft').click();await frame.waitForFunction(()=>!document.querySelector('[data-inline-editor]'));assert.equal(await frame.locator('#target').textContent(),text)};
  for(const preset of ['auto','phone'])for(const zoom of ['fit','actual']){
   await mode(preset,zoom);
   // Residual native shell selection may not contaminate the frame's UTF16 Range.
   await page.locator(width<600?'.brand':'#hs-docname').dblclick();await select('#target',0,text.length);
   assert(await action.isEnabled());await action.click();await frame.locator('[data-inline-editor]').waitFor().catch(async e=>{console.log({width,preset,zoom,errors:evidence.errors,reason:await page.locator('#rewrite-reason').textContent(),status:await page.locator('#hs-status').textContent(),frame:await frame.locator('#target').innerHTML()});throw e});assert.equal(await frame.locator('[data-inline-editor]').textContent(),text);
   await page.keyboard.insertText('replacement');assert.equal(await frame.locator('[data-inline-editor]').textContent(),'replacement');
   if(out)await page.screenshot({path:`${out}/${width}-${preset}-${zoom}-single-li.png`});
   const before=await frame.locator('#retained').inputValue();// Composer is modal; simulate layout-control events without bypassing submit/auth.
   await page.locator('#preview-dock-toggle').dispatchEvent('click');await page.locator('#preview-dock-toggle').dispatchEvent('click');
   assert.equal(await frame.locator('[data-inline-editor]').textContent(),'replacement');assert.equal(await frame.locator('#retained').inputValue(),before);assert(await page.evaluate(()=>savedFrame===document.querySelector('iframe')));
   metrics.push({width,preset,zoom,singleLiContext:true});await cancel();
  }
  await mode('auto','fit');
  // Rich markup supports explicit drafts without flattening unaffected inline nodes.
  const rich=await frame.locator('#rich').textContent(),at=rich.lastIndexOf('same');await select('#rich',at,at+4);
  assert(await action.isEnabled());await action.click();await frame.locator('[data-inline-editor]').waitFor();await page.keyboard.insertText('rich draft');await cancel();assert.equal(await frame.locator('#rich em').textContent(),'emphasis');assert.equal(await frame.locator('#rich strong').textContent(),'bold');assert.equal(await frame.locator('#rich a').textContent(),'link');assert.equal(await frame.locator('#rich').textContent(),rich);
  // Wrapped paragraph is a supported single semantic block; native paste and IME
  // now edit ONLY replacement text, with no host boundary/merge opportunities.
  await select('#paragraph',1,2);await action.click();await frame.locator('[data-inline-editor]').waitFor();await page.keyboard.insertText('replacement');assert.equal(await frame.locator('[data-inline-editor]').textContent(),'replacement');await cancel();
  for(const [offset,key] of [[0,'Backspace'],[text.length,'Delete']]){await select('#target',offset,offset);await page.keyboard.press(key);assert.equal(await frame.locator('#items>li').count(),5);assert.equal(await frame.locator('#target').textContent(),text)}
  // Genuine cross-li/nested-p/grouped-p selection cannot mutate by keys/paste,
  // and must not leave a functioning stale replacement context.
  for(const [a,b] of [['#target','#rich'],['#nested-a','#nested-b'],['#paragraph','[data-hs-group] p']]){
   const before=await frame.locator('body').innerHTML();await frame.evaluate(([a,b])=>{const el=document.querySelector(a),last=document.querySelector(b),r=document.createRange();r.setStart(el.firstChild,0);r.setEnd(last.firstChild,2);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'))},[a,b]);await page.waitForTimeout(100);
   assert(!await action.isVisible()||await action.isDisabled());await page.keyboard.insertText('BAD');await frame.locator(a).evaluate(el=>{const d=new DataTransfer();d.setData('text/plain','BAD PASTE\ntwo paragraphs');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}))});assert.equal(await frame.locator('body').innerHTML(),before);assert.equal(await page.locator('#draft-actions').isVisible(),false);assert(!await page.locator('#composer').isVisible());
  }
  await select('#target',0,2);await action.click();await frame.locator('[data-inline-editor]').waitFor();const cdp=await ctx.newCDPSession(page);await cdp.send('Input.imeSetComposition',{text:'中文',selectionStart:2,selectionEnd:2});await cdp.send('Input.insertText',{text:'中文'});assert.equal(await frame.locator('[data-inline-editor]').textContent(),'中文');await cancel();
  assert.notEqual(await frame.locator('[data-hs-group]').getAttribute('contenteditable'),'true');assert.equal(await frame.locator('#target').textContent(),text);assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.writes,[]);await ctx.close();
 }
 if(out)await writeFile(out+'/list-metrics.json',JSON.stringify(metrics,null,2));console.log('PASS explicit inline list context: 1440/390 Auto/phone Fit/100%, stale shell selection, rich-node edit/cancel, inline IME, wrapped p, edge deletion, real crossblock key/paste no mutation, frame/input/draft retention; zero writes.');
}finally{await browser.close()}
