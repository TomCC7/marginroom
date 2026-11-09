import assert from 'node:assert/strict';
import {launchBrowser,isolate,syntheticFixture,openFixture} from './helpers/browser.mjs';
const browser=await launchBrowser();
try{
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),fixture=syntheticFixture();
 fixture.doc.baseHtml='<style>body{margin:0}#mq{width:90vw}@media(max-width:500px){#mq{color:rgb(255,0,0)}}</style><h1>Static viewport</h1><p id="quote">same same 😀 text</p><input id="form" value="initial"><div id="mq">viewport</div><div style="height:2000px"></div><script>window.RAW_RAN=true</script><img onerror="window.RAW_RAN=true">';
 const evidence=await isolate(ctx,fixture),payloads=[];
 // Parent's viewport UI is independently implemented. This fixture exercises the
 // published adapter contract without depending on an in-flight UI module.
 await ctx.route('**/preview-viewport.js',r=>r.fulfill({contentType:'text/javascript',body:'export function initPreview(o){window.previewTest=o;return o.staticPreview}'}));
 await ctx.route('**/api/suggest/synthetic',async r=>{const b=r.request().postDataJSON();payloads.push(b);const suggestion={id:'test-'+payloads.length,anchor:b.anchor,kind:b.kind,quote:b.quote,body:b.body,base_text:b.baseText,range_start:b.rangeStart,range_end:b.rangeEnd,status:'open',author:'Synthetic',created_at:new Date().toISOString()};fixture.records.push(suggestion);await r.fulfill({json:{suggestion}})});
 await ctx.route('**/api/edit/synthetic',async r=>{const b=r.request().postDataJSON();payloads.push(b);await r.fulfill({json:{overlay:{[b.anchor]:b.text}}})});
 const page=await ctx.newPage();await openFixture(page);
 const anchors=await page.locator('#hs-doc-root [data-hs-anchor]').evaluateAll(ns=>ns.map(n=>n.dataset.hsAnchor));
 await page.evaluate(async()=>{await previewTest.staticPreview.setActive(true);const f=previewTest.staticPreview.frame;f.style.width='390px';f.style.height='600px'});
 const frame=page.frames().find(f=>f!==page.mainFrame());assert(frame);
 assert.equal(await page.locator('iframe.hs-static-preview').getAttribute('sandbox'),'allow-scripts');
 assert.equal(await frame.evaluate(()=>window.RAW_RAN),undefined);
 assert.equal(await frame.evaluate(()=>getComputedStyle(document.querySelector('#mq')).color),'rgb(255, 0, 0)');
 assert.deepEqual(await frame.locator('[data-hs-anchor]').evaluateAll(ns=>ns.map(n=>n.dataset.hsAnchor)),anchors);
 await page.evaluate(()=>{const f=previewTest.staticPreview.frame,token=f.srcdoc.match(/window.__staticPreviewToken="([a-f0-9]+)"/)[1],anchor=document.querySelector('#quote').dataset.hsAnchor;window.dispatchEvent(new MessageEvent('message',{origin:'null',source:window,data:{channel:'static-preview',token,type:'input',anchor,text:'FORGED'}}))});
 assert.equal(await page.locator('#hs-doc-root #quote').textContent(),'same same 😀 text');
 await frame.locator('#form').fill('retained');await frame.evaluate(()=>scrollTo(0,400));assert.equal(await frame.evaluate(()=>scrollY),400);
 await page.evaluate(async()=>{window.originalFrame=previewTest.staticPreview.frame;await previewTest.staticPreview.setActive(false);await previewTest.staticPreview.setActive(true);previewTest.staticPreview.frame.style.width='800px'});
 assert.equal(await page.evaluate(()=>originalFrame===previewTest.staticPreview.frame),true);
 assert.equal(await frame.locator('#form').inputValue(),'retained');await frame.waitForFunction(()=>scrollY===400);
 assert.notEqual(await frame.evaluate(()=>getComputedStyle(document.querySelector('#mq')).color),'rgb(255, 0, 0)');
 await page.locator('[data-mode="suggest"]').first().click();await frame.evaluate(()=>{scrollTo(0,0);const n=document.querySelector('#quote').firstChild,r=document.createRange();r.setStart(n,5);r.setEnd(n,9);getSelection().removeAllRanges();getSelection().addRange(r)});
 await page.locator('#selection-action').waitFor({state:'visible'});await page.locator('#selection-action').click();await page.locator('#comment-body').fill('second occurrence');await page.locator('#send-comment').click();
 await page.waitForFunction(()=>document.querySelector('#composer').hidden);assert.equal(payloads[0].rangeStart,5);assert.equal(payloads[0].rangeEnd,9);assert.equal(payloads[0].quote,'same');
 await frame.locator('#quote').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'))});await page.locator('#selection-suggest').click();await page.locator('#comment-body').fill('!abc');
 await page.evaluate(async()=>{await previewTest.staticPreview.setActive(false);await previewTest.staticPreview.setActive(true)});assert.equal(await page.locator('#comment-body').inputValue(),'!abc');
 await page.locator('#send-comment').click();await page.waitForFunction(()=>document.querySelector('#composer').hidden);assert.equal(payloads[1].kind,'rewrite');assert.equal(payloads[1].body,'!abc');
 await page.locator('#more-btn').click();await page.locator('#direct-edit-menu').click();await frame.waitForFunction(()=>document.querySelector('#quote').contentEditable==='true');await frame.locator('#quote').click();await frame.locator('#quote').press('End');await frame.locator('#quote').press('?');await page.waitForFunction(()=>document.querySelector('#hs-status').textContent.includes('正文已保存'));assert.match(payloads.at(-1).text,/\?/);
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.writes,[]);
 console.log('PASS static viewport: sandbox, stripped scripts, media queries, stable anchors/frame, form+scroll roundtrip, repeated-quote offsets, comment, retained suggestion draft+submit, direct edit.');
 await ctx.close();
}finally{await browser.close()}
