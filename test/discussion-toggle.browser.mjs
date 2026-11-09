// Bounded GET-only toggle regression; no live service or persisted writes.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser,isolate,syntheticFixture,openFixture} from './helpers/browser.mjs';
const browser=await launchBrowser(),out=process.env.TOGGLE_ARTIFACTS,metrics=[];
if(out)await mkdir(out,{recursive:true});
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900}}),fixture=syntheticFixture();
  fixture.doc.hasRaw=true;const html='<html><body><h1>讨论面板开关</h1><input id="retained" value="initial"><p>Imported application state stays connected.</p></body></html>';fixture.doc.baseHtml=html;
  fixture.records=Array.from({length:16},(_,i)=>({id:'toggle-'+i,kind:'comment',anchor:'h1-0',quote:'讨论面板开关',body:'Review note '+i+' '+ '独立讨论内容。'.repeat(40),author:'Synthetic reviewer',status:'open',created_at:'2026-01-01T00:00:00Z',replies:[]}));
  const evidence=await isolate(context,fixture);await context.route('**/api/raw/synthetic',r=>r.fulfill({json:{rawHtml:html}}));
  await context.addInitScript(()=>{if(window===top){window.loads=0;document.addEventListener('load',e=>{if(e.target.tagName==='IFRAME')loads++},true)}});
  const page=await context.newPage();page.setDefaultTimeout(6000);await openFixture(page);const frame=page.frames()[1];await frame.locator('#retained').fill('unsent iframe input');await page.evaluate(()=>window.originalFrame=document.querySelector('iframe'));
  const button=page.locator(width>600?'.topbar .show-discussion':'.comment-toggle'),settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
  async function check(open,label){await settle();assert.equal(await page.locator('.discussion').isVisible(),open,label);for(const s of ['.show-discussion','.comment-toggle']){assert.equal(await page.locator(s).getAttribute('aria-expanded'),String(open),label+' aria');assert.equal(await page.locator(s).evaluate(n=>n.classList.contains('selected')),open);assert.equal(await page.locator(s+' .total').textContent(),'16')}
   assert.equal(await frame.locator('#retained').inputValue(),'unsent iframe input');assert(await page.evaluate(()=>originalFrame===document.querySelector('iframe')&&loads===1));const dims=await frame.evaluate(()=>[innerWidth,innerHeight]);metrics.push({width,label,open,dims});return dims}
  await check(width>1100,'initial');
  // This first click is the original bug: desktop is initially open.
  await button.click();await check(width<=1100,'first click');
  for(let i=0;i<3;i++){await button.click();await check(width>1100?i%2===0:i%2!==0,'repeat '+i)}
  // Native buttons already synthesize click for both keys: never add key handlers.
  if(await page.locator('.discussion').isVisible())await button.click();
  await button.focus();await page.keyboard.press('Enter');await check(true,'Enter open');await page.keyboard.press('Space');await check(false,'Space close');
  await button.click();const openDims=await check(true,'reopen');if(out)await page.screenshot({path:`${out}/${width}-open.png`});
  const scroll=await page.evaluate(()=>({y:scrollY,stage:document.querySelector('#article').scrollTop}));const threadsBox=await page.locator('#threads').boundingBox();await page.mouse.move(threadsBox.x+30,threadsBox.y+50);await page.mouse.wheel(0,600);await page.waitForTimeout(150);assert(await page.locator('#threads').evaluate(n=>n.scrollTop>0));assert.deepEqual(await page.evaluate(()=>({y:scrollY,stage:document.querySelector('#article').scrollTop})),scroll);
  await page.locator('.close-drawer').click();const closedDims=await check(false,'close button');if(width>1100)assert.equal(closedDims[0]-openDims[0],320);else assert.deepEqual(closedDims,openDims);if(out)await page.screenshot({path:`${out}/${width}-closed.png`});
  await page.selectOption('#preview-mode','desktop');await frame.waitForFunction(()=>innerWidth===1440&&innerHeight===900);await button.click();assert.deepEqual(await check(true,'preset open'),[1440,900]);await button.click();assert.deepEqual(await check(false,'preset close'),[1440,900]);
  // List navigation must FORCE open. Calling it again while already open cannot close.
  await button.click();await page.locator('[data-view="list"]').click();await check(true,'rail list');await page.locator('[data-record="toggle-0"]').click();await check(true,'list entry');
  await page.locator('#list-records').evaluate(n=>n.querySelector('[data-record="toggle-0"]').click());await check(true,'same anchor twice');assert(await page.locator('#thread-toggle-0').evaluate(n=>n.classList.contains('active')));
  if(width<600){await page.locator('.comment-toggle').click();await check(false,'bottom close');await page.locator('.comment-toggle').click();await check(true,'bottom open')}
  // A reply draft lives in the existing modal; panel actions must never erase it.
  await page.locator('[data-reply="toggle-0"]').click();await page.locator('#comment-body').fill('unsent reply');await button.evaluate(n=>n.click());assert.equal(await page.locator('#comment-body').inputValue(),'unsent reply');assert(await page.locator('#composer').isVisible());page.once('dialog',d=>d.accept());await page.locator('#cancel-comment').click();
  // Responsive default changes must be reflected without needing a click.
  await page.setViewportSize({width:width===1440?390:1440,height:900});await settle();assert.equal(await button.getAttribute('aria-expanded'),String(await page.locator('.discussion').isVisible()));
  assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.writes,[]);await context.close();
  // Article anchors and inline suggestion drafts use the real static document path.
  const articleContext=await browser.newContext({viewport:{width,height:900}}),articleFixture=syntheticFixture(),articleEvidence=await isolate(articleContext,articleFixture),article=await articleContext.newPage();
  await openFixture(article);await article.waitForFunction(()=>document.querySelector('iframe')?.dataset.previewScale);
  const anchor=await article.locator('#hs-doc-root p[data-hs-anchor]').first().evaluate(n=>({anchor:n.dataset.hsAnchor,text:n.textContent}));
  articleFixture.records=[{id:'inline',anchor:anchor.anchor,base_text:anchor.text,quote:anchor.text.slice(0,20),range_start:0,range_end:20,body:'Inline fixture',kind:'comment',status:'open',author:'Synthetic',created_at:'2026-01-01T00:00:00Z',replies:[]}];
  await openFixture(article);const articleButton=article.locator(width>600?'.topbar .show-discussion':'.comment-toggle');
  const content=article.frames()[1];const marker=content.locator('.marker[data-thread="inline"]');await marker.scrollIntoViewIfNeeded();await article.evaluate(()=>scrollBy(0,-120));await marker.click();await article.locator('.discussion').waitFor({state:'visible'});assert(await article.locator('.discussion').isVisible());
  // On mobile the overlay covers the marker; dispatch the same real anchor handler twice.
  await marker.evaluate(n=>n.click());await article.locator('.discussion').waitFor({state:'visible'});assert(await article.locator('.discussion').isVisible());assert.equal(await articleButton.getAttribute('aria-expanded'),'true');
  await article.locator('.close-drawer').click();await article.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r)))));await marker.click();await article.locator('.discussion').waitFor({state:'visible'});assert(await article.locator('.discussion').isVisible());await article.locator('.close-drawer').click();
  if(width<600){const y=await content.evaluate(()=>scrollY),b=await article.locator('iframe').boundingBox();await article.mouse.move(b.x+25,b.y+200);await article.mouse.wheel(0,250);await article.waitForTimeout(200);assert(await content.evaluate(()=>scrollY)>y,'iframe scroll restored after overlay closes')}
  await article.locator(width>600?'.topbar [data-mode="suggest"]':'.dock [data-mode="suggest"]').click();
  const editable=content.locator('p[data-hs-anchor]').nth(2),original=await editable.textContent();await editable.click();await article.keyboard.press('Home');await article.keyboard.type('Unsent suggestion ');assert(await article.locator('#draft-actions').isVisible());
  const draftText=await editable.textContent();await articleButton.click();assert(await article.locator('.discussion').isHidden());assert.equal(await editable.textContent(),draftText);assert(await article.locator('#draft-actions').isVisible());assert((await article.locator('#toast').textContent()).includes('草稿'));
  await article.locator('#cancel-draft').click();assert.equal(await editable.textContent(),original);await articleButton.click();await article.locator('.discussion').waitFor({state:'visible'});assert(await article.locator('.discussion').isVisible());
  assert.deepEqual(articleEvidence.errors,[]);assert.deepEqual(articleEvidence.writes,[]);await articleContext.close();
 }
 if(out)await writeFile(out+'/metrics.json',JSON.stringify(metrics,null,2));console.log('PASS 1440/390: repeated toggle, Enter/Space, close/reopen, ARIA/count/style, list + inline force-open, bottom entry, reply + suggestion draft retention, thread/body scroll ownership, Auto/preset sizes, exact iframe/input retention; zero writes.');
}finally{await browser.close()}
