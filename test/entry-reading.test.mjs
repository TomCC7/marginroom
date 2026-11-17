import assert from 'node:assert/strict';
import {sanitizeReading,readingPosition,initReading} from '../public/entry-reading.js';
import {JSDOM} from 'jsdom';
import {launchBrowser,isolate,syntheticFixture,openFixture} from './helpers/browser.mjs';
import {resolveParagraph} from '../revision-service.js';
assert.equal(sanitizeReading({x:NaN,y:1}),null);
assert.equal(sanitizeReading({x:1,y:1e20}),null);
assert.deepEqual(sanitizeReading({x:-1,y:20,html:'private',forms:['secret'],anchor:'stable',offset:-8,containers:[{anchor:'a',up:1,x:3,y:4,text:'secret'},{anchor:'b',up:17,x:1,y:2}]}),{x:0,y:20,anchor:'stable',offset:-8,containers:[{x:3,y:4,anchor:'a',up:1}]});
// Corrupt, unavailable and unknown-version storage must never prevent loading.
for(const raw of ['bad','{"v":99}','null']){
 const dom=new JSDOM('<article><main><div id="root"></div></main></article>',{url:'http://reading.test'}),win=dom.window;
 win.requestAnimationFrame=fn=>fn();win.scrollTo=()=>{};
 const root=win.document.querySelector('#root'),api=initReading({docId:'canonical',root,article:root.parentElement.parentElement,main:root.parentElement,win,storage:{getItem:()=>raw,setItem(){throw Error('blocked')}}});
 api.ready();api.persist();dom.window.close();
}
// These exact functions are stringified into the opaque static controller.
assert.equal(typeof Function('return ('+readingPosition.toString()+')')(),'function');
assert.deepEqual(Function('return ('+sanitizeReading.toString()+')')()({x:1,y:2}),{x:1,y:2,containers:[]});
const browser=await launchBrowser();
try{
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),fixture=syntheticFixture(),evidence=await isolate(ctx,fixture);
 await ctx.route('**/api/doc-meta/*',r=>r.fulfill({json:{id:'synthetic',title:'Canonical fixture title'}}));
 // Reading/leave-guard fixture is read-only; persistence is exercised separately
 // against real HTTP/SQLite in continuous-revision.browser.mjs.
 await ctx.route('**/api/revision/*',r=>{assert.equal(r.request().method(),'GET');const anchor=new URL(r.request().url()).searchParams.get('anchor'),baseText=resolveParagraph(fixture.doc.baseHtml,anchor);return r.fulfill({json:{anchor,baseText,proposedText:baseText,version:'0'.repeat(64),sourceHash:'0'.repeat(64),records:[]}})});
 await ctx.route('http://frontend.test/',r=>r.fulfill({body:'<!doctype html><title>Home fixture</title><h1>Home</h1>',contentType:'text/html'}));
 const page=await ctx.newPage();await openFixture(page);await page.waitForSelector('iframe.hs-static-preview');
 let frame=page.frames().find(f=>f!==page.mainFrame());await frame.waitForFunction(()=>document.querySelector('[data-hs-anchor]'));
 await page.waitForTimeout(100);
 assert.equal(await page.locator('#viewer-home').getAttribute('href'),'/');
 assert.match(await page.title(),/Marginroom/);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('marginroom.recent.v1')).entries[0].title),'Canonical fixture title');
 await page.locator('#preview-mode').selectOption('desktop');await page.locator('#preview-zoom').selectOption('actual');await page.waitForTimeout(100);
 await page.locator('#article').evaluate(el=>el.scrollTo(100,90));
 await frame.evaluate(()=>scrollTo(0,1300));await page.waitForTimeout(400);
 const position=await page.evaluate(()=>JSON.parse(localStorage.getItem('marginroom.reading.v1:synthetic')));
 assert.equal(position.article.x,100);assert.equal(position.article.y,90);
 assert.equal(position.content.y,1300);assert.ok(position.content.anchor);assert.ok(!JSON.stringify(position).includes('Synthetic prose'));
 await page.reload();await page.waitForFunction(()=>document.querySelector('#hs-status').textContent.includes('已同步'));await page.waitForSelector('iframe.hs-static-preview');
 frame=page.frames().find(f=>f!==page.mainFrame());await frame.waitForFunction(()=>scrollY===1300);
 assert.deepEqual(await page.locator('#article').evaluate(el=>({x:el.scrollLeft,y:el.scrollTop})),position.article);
 // Restoration is one-shot, not a loop that fights subsequent reading.
 await frame.evaluate(()=>scrollTo(0,1600));await page.waitForTimeout(400);assert.equal(await frame.evaluate(()=>scrollY),1600);
 // An empty composer is not an unsaved draft; typed text is, and Stay preserves it.
 await page.evaluate(()=>{document.querySelector('#composer').hidden=false;document.querySelector('#comment-body').value=''});
 assert.equal(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});dispatchEvent(e);return e.defaultPrevented}),false);
 await page.evaluate(()=>{document.querySelector('#comment-body').value='never swallow this text';document.querySelector('#shade').hidden=false});
 await page.locator('#viewer-home').click();
 await page.locator('#leave-dialog').waitFor({state:'visible'});await page.locator('#leave-stay').click();
 assert.equal(await page.locator('#comment-body').inputValue(),'never swallow this text');
 assert.equal(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});dispatchEvent(e);return e.defaultPrevented}),true);
 // A normal composer close must also ask, even when its handler receives an Event.
 await page.locator('#cancel-comment').click();await page.locator('#leave-dialog').waitFor({state:'visible'});await page.locator('#leave-discard').click();
 assert.equal(await page.locator('#composer').isHidden(),true);
 await page.locator('[data-mode="suggest"]').first().click();await frame.evaluate(()=>scrollTo(0,0));
 await frame.locator('p').first().click();await page.locator('#selection-suggest').waitFor({state:'visible'});await page.locator('#selection-suggest').click();
 await frame.locator('[data-inline-editor]').waitFor();
 assert.equal(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});dispatchEvent(e);return e.defaultPrevented}),false);
 await frame.locator('[data-inline-editor]').evaluate(el=>{el.focus();const range=document.createRange();range.selectNodeContents(el);const sel=getSelection();sel.removeAllRanges();sel.addRange(range)});
 await page.keyboard.insertText('actual changed inline draft');
 await page.waitForTimeout(100);await page.locator('#viewer-home').click();await page.locator('#leave-dialog').waitFor({state:'visible'});await page.locator('#leave-stay').click();
 assert.equal(await frame.locator('[data-inline-editor]').evaluate(el=>{const clone=el.cloneNode(true);clone.querySelectorAll('[data-inline-old],[data-inline-foreign]').forEach(n=>n.remove());return clone.textContent}),'actual changed inline draft');
 await page.locator('#cancel-draft').click();
 let editAttempts=0;await ctx.route('**/api/edit/synthetic',r=>{editAttempts++;return r.fulfill({status:503,json:{error:'Synthetic save failure'}})});
 await page.locator('#more-btn').click();await page.locator('#direct-edit-menu').click();await frame.waitForFunction(()=>document.querySelector('p')?.contentEditable==='true');
 await frame.locator('p').first().fill('unsaved direct edit text');await page.waitForFunction(()=>document.querySelector('#hs-status').textContent.includes('正文未保存'));
 await page.locator('#viewer-home').click();await page.locator('#leave-dialog').waitFor({state:'visible'});await page.locator('#leave-save').click();
 await page.waitForFunction(()=>document.querySelector('#leave-message').textContent.includes('仍有内容未保存'));
 assert.equal(await frame.locator('p').first().textContent(),'unsaved direct edit text');assert.ok(editAttempts>=2);
 await page.locator('#leave-stay').click();await page.locator('#viewer-home').click();await page.locator('#leave-dialog').waitFor({state:'visible'});await page.locator('#leave-discard').click();
 await page.waitForURL('http://frontend.test/');
 await openFixture(page);
 for(const width of [390,768,1024]){await page.setViewportSize({width,height:900});await page.waitForTimeout(100);assert.ok(await page.locator('#viewer-home').isVisible());const box=await page.locator('#more-btn').boundingBox();assert.ok(box.x+box.width<=width,`topbar overflow at ${width}: ${JSON.stringify(box)}`)}
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.writes,[]);
 await ctx.close();
 const ordinary=await browser.newContext({viewport:{width:1440,height:1000}}),ordinaryFixture=syntheticFixture(),ordinaryEvidence=await isolate(ordinary,ordinaryFixture);
 await ordinary.route('**/api/doc-meta/*',r=>r.fulfill({json:{id:'synthetic',title:'Ordinary fixture'}}));
 await ordinary.route('**/preview-viewport.js',r=>r.fulfill({contentType:'text/javascript',body:`export function initPreview(){const a=document.querySelector('#article');a.style.height='500px';a.style.maxHeight='500px';a.style.overflow='auto';document.dispatchEvent(new Event('preview-change'));}`}));
 const ordinaryPage=await ordinary.newPage();await openFixture(ordinaryPage);await ordinaryPage.waitForTimeout(100);
 await ordinaryPage.locator('#article').evaluate(el=>el.scrollTo(0,1200));await ordinaryPage.waitForTimeout(400);
 const ordinarySaved=await ordinaryPage.evaluate(()=>JSON.parse(localStorage.getItem('marginroom.reading.v1:synthetic')));
 assert.equal(ordinarySaved.article.y,1200);assert.ok(ordinarySaved.content.anchor);
 ordinaryFixture.doc.baseHtml='<div style="height:200px"></div>'+ordinaryFixture.doc.baseHtml;
 await ordinaryPage.reload();await ordinaryPage.waitForFunction(()=>document.querySelector('#hs-status').textContent.includes('已同步'));await ordinaryPage.waitForTimeout(150);
 const anchoredTop=await ordinaryPage.locator('[data-hs-anchor]').evaluateAll((ns,a)=>ns.find(n=>n.dataset.hsAnchor===a).getBoundingClientRect().top,ordinarySaved.content.anchor);
 assert.ok(Math.abs(anchoredTop-ordinarySaved.content.offset)<2,'ordinary stable-anchor offset survives content inserted above');
 assert.equal(await ordinaryPage.locator('#article').evaluate(el=>el.scrollTop),1400);
 assert.deepEqual(ordinaryEvidence.errors,[]);assert.deepEqual(ordinaryEvidence.writes,[]);await ordinary.close();
 const missing=await browser.newContext(),missingEvidence=await isolate(missing,syntheticFixture());
 await missing.route('**/api/doc/*',r=>r.fulfill({status:404,json:{error:'not_found'}}));
 const missingPage=await missing.newPage();await missingPage.goto('http://frontend.test/viewer.html?doc=synthetic');await missingPage.waitForSelector('#hs-empty');
 assert.equal(await missingPage.evaluate(()=>localStorage.getItem('marginroom.recent.v1')),null);
 assert.equal(await missingPage.evaluate(()=>localStorage.getItem('marginroom.reading.v1:synthetic')),null);
 assert.equal(missingEvidence.requests.some(p=>p.startsWith('/api/doc-meta/')),false);await missing.close();
 console.log('PASS reading validation/storage failure safety, ordinary stable-anchor restoration after layout drift, isolated static-frame restoration + stage pan + one-shot scrolling, canonical history, responsive home link, empty/typed composer and inline beforeunload, stay/discard and failed direct-edit save guards; no external requests/writes.');
}finally{await browser.close()}
