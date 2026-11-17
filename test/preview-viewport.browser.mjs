// Portable, synthetic-only real iframe viewport and state regression.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser,isolate,syntheticFixture,openFixture} from './helpers/browser.mjs';
import {preferences,dimensions} from '../public/preview-viewport.js';
assert.equal(preferences({mode:'bogus',custom:{width:-2,height:Infinity}}).mode,'auto');
assert.deepEqual(dimensions(preferences({mode:'phone',rotated:true})),[844,390]);
for(const invalid of [null,[],{custom:{width:'1200',height:0}},{mode:'constructor',zoom:'NaN',custom:{width:1.5,height:1e9}}]){const p=preferences(invalid);assert.equal(p.mode,'auto');assert.deepEqual(p.custom,{width:1280,height:800})}
const css=`*{box-sizing:border-box}body{margin:0;background:#111827;color:#e5e7eb;font:16px system-ui}header{position:sticky;top:0;background:#1f2937;padding:20px;z-index:2}main{padding:28px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.card{background:#243247;border:1px solid #52647e;padding:24px;border-radius:10px}input,button{font:inherit;padding:8px}input{max-width:100%}#vh{height:100vh;width:100vw;position:fixed;pointer-events:none;visibility:hidden}#breakpoint:after{content:'DESKTOP'}@media(max-width:600px){.grid{grid-template-columns:1fr}#breakpoint:after{content:'PHONE'}main{padding:14px}}footer{position:fixed;bottom:0;left:0;width:100vw;padding:16px;background:#374151;z-index:3}#nested{height:90px;overflow:auto;background:#172033;padding:8px}dialog{color:#111827;padding:30px}p{line-height:1.8}`;
export const dashboard=`<!doctype html><html><head><style>${css}</style></head><body><header><strong>Policy rollout · responsive dashboard</strong> <span id="breakpoint"></span></header><main><h1>Review the actual layout</h1><div class="grid"><section class="card"><h2>Session</h2><input id="input" value="initial"><button id="count">Count <span id="counter">0</span></button></section><section class="card"><h2>Nested scroll</h2><div id="nested">${'<p>Nested row</p>'.repeat(12)}</div></section><section class="card"><h2>Modal</h2><button id="modal">Open dialog</button><dialog><p>Viewport dialog</p><button id="close">Close</button></dialog></section></div><p id="repeat">same same 😀 same same.</p><div style="height:1100px"></div><p id="last">Last passage</p></main><div id="vh"></div><footer>Fixed footer · viewport owned</footer><script>let n=0;document.querySelector('#count').onclick=()=>document.querySelector('#counter').textContent=++n;document.querySelector('#modal').onclick=()=>document.querySelector('dialog').showModal();document.querySelector('#close').onclick=()=>document.querySelector('dialog').close();window.fixtureBoots=(window.fixtureBoots||0)+1</script></body></html>`;
const browser=await launchBrowser(),out=process.env.PREVIEW_ARTIFACTS;
if(out)await mkdir(out,{recursive:true});
let cases=0;const screenshots=[];
try{
 for(const interactive of [false,true]){
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),fixture=syntheticFixture();fixture.doc.baseHtml=dashboard;fixture.doc.hasRaw=interactive;
  const evidence=await isolate(ctx,fixture);
  if(interactive)await ctx.route('**/api/raw/synthetic',r=>r.fulfill({json:{rawHtml:dashboard}}));
  await ctx.addInitScript(()=>{if(window===top){window.__previewLoads=0;document.addEventListener('load',e=>{if(e.target.tagName==='IFRAME')window.__previewLoads++},true)}});
  const page=await ctx.newPage();page.setDefaultTimeout(10000);await openFixture(page);await page.locator('#preview-dock-toggle').click();
  if(interactive){assert.equal(await page.locator('#hs-warn').textContent(),'');assert.equal(await page.locator('#hs-warn').evaluate(n=>n.getBoundingClientRect().height),0,'no standing sandbox explanation or reserved space');const readme=await (await import('node:fs/promises')).readFile(new URL('../README.md',import.meta.url),'utf8');assert.match(readme,/runtime-generated content remains comment-only/);assert.match(readme,/Only open downloads from authors you trust/)}
  assert.equal(await page.locator('#preview-mode').inputValue(),'auto');
  await page.selectOption('#preview-mode','auto');await page.waitForFunction(()=>document.body.classList.contains('preview-device'));
  if(out){const file=`${interactive?'interactive':'static'}-auto.png`;await page.screenshot({path:out+'/'+file});screenshots.push({file,mode:'auto',host:await page.viewportSize()})}
  await page.selectOption('#preview-mode','desktop');await page.waitForFunction(()=>document.body.classList.contains('preview-device'));
  let frame=page.frames().find(f=>f!==page.mainFrame());assert(frame);
  await frame.waitForFunction(()=>innerWidth===1440&&innerHeight===900);
  await page.waitForFunction(()=>window.__previewLoads===1);const originalLoads=await page.evaluate(()=>window.__previewLoads);assert.equal(originalLoads,1,'Exactly one initial document iframe load');await page.evaluate(()=>window.originalPreviewFrame=document.querySelector('#hs-doc-root>iframe'));
  assert.equal(await page.locator('#hs-doc-root>iframe').getAttribute('sandbox'),'allow-scripts');
  assert.equal(await frame.evaluate(()=>{try{return !!parent.document}catch{return false}}),false);
  await frame.locator('#input').fill('retained form');
  // Playwright's cross-origin frame locator click does not account for iframe
  // CSS transforms in this Chromium build. Drive real mouse coordinates instead.
  async function clickInside(selector){await frame.locator(selector).evaluate(n=>{const r=n.getBoundingClientRect();scrollTo(scrollX,scrollY+r.y+r.height/2-innerHeight/2)});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const r=await frame.locator(selector).evaluate(n=>{const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}});const b=await page.locator('#hs-doc-root>iframe').boundingBox(),w=await frame.evaluate(()=>innerWidth),h=await frame.evaluate(()=>innerHeight);await page.mouse.click(b.x+r.x*b.width/w,b.y+r.y*b.height/h)}
  if(interactive){await clickInside('#count');await frame.waitForFunction(()=>document.querySelector('#counter').textContent==='1')}
  const originalAnchor=await frame.locator('#repeat').getAttribute('data-hs-anchor');assert(originalAnchor);
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:window,data:{type:'suggestTarget',anchor:'forged',rect:{left:1,top:1,width:1,height:1}}})));
  assert.equal(await page.locator('#composer').isHidden(),true);
  for(const hostWidth of [1440,1024,390,360]){
   await page.setViewportSize({width:hostWidth,height:1000});
   if(out){await page.selectOption('#preview-mode','auto');await page.waitForFunction(()=>document.body.classList.contains('preview-device'));const file=`${interactive?'interactive':'static'}-${hostWidth}-auto.png`;await page.screenshot({path:out+'/'+file});screenshots.push({file,mode:'auto',host:await page.viewportSize()});await page.selectOption('#preview-mode','desktop');await page.waitForFunction(()=>document.body.classList.contains('preview-device'))}
   for(const [mode,w,h] of [['desktop',1440,900],['laptop',1366,768],['tablet',768,1024],['phone',390,844]]){
    await page.selectOption('#preview-mode',mode);await frame.waitForFunction(([w,h])=>innerWidth===w&&innerHeight===h,[w,h]);
    assert.equal(await frame.evaluate(()=>getComputedStyle(document.querySelector('#breakpoint'),'::after').content),w<=600?'"PHONE"':'"DESKTOP"');
    const internal=await frame.evaluate(()=>({width:innerWidth,height:innerHeight,vw:document.querySelector('#vh').getBoundingClientRect().width,vh:document.querySelector('#vh').getBoundingClientRect().height,footerBottom:document.querySelector('footer').getBoundingClientRect().bottom}));
    assert.equal(internal.vw,w);assert.equal(internal.vh,h);assert.equal(internal.footerBottom,h);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'shell must not overflow');
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));
    assert.equal(await page.evaluate(()=>{const a=document.querySelector('#article');return a.scrollWidth<=a.clientWidth+1}),true,'Fit must not leave unscaled overflow in the stage');
    assert.equal(await frame.locator('#input').inputValue(),'retained form');assert.equal(await frame.locator('#repeat').getAttribute('data-hs-anchor'),originalAnchor);
    if(interactive)assert.equal(await frame.locator('#counter').textContent(),'1');
    assert.equal(await page.evaluate(()=>originalPreviewFrame===document.querySelector('#hs-doc-root>iframe')),true);assert.equal(await page.evaluate(()=>window.__previewLoads),originalLoads,'exact iframe load count');
    if(out&&['desktop','phone'].includes(mode)){const file=`${interactive?'interactive':'static'}-${hostWidth}-${mode}.png`;await page.screenshot({path:out+'/'+file});screenshots.push({file,host:await page.viewportSize(),internal,scale:await page.locator('iframe').getAttribute('data-preview-scale')})}
    cases++;
   }
  }
  await page.setViewportSize({width:1440,height:1000});await page.selectOption('#preview-mode','desktop');
  const before=Number(await page.locator('iframe').getAttribute('data-preview-scale'));await page.locator('#nav-toggle').click();await page.locator('.close-drawer').click();await page.waitForFunction(before=>Number(document.querySelector('iframe').dataset.previewScale)>before,before);
  await page.locator('#preview-rotate').click();await frame.waitForFunction(()=>innerWidth===900&&innerHeight===1440);await page.locator('#preview-rotate').click();await frame.waitForFunction(()=>innerWidth===1440&&innerHeight===900);
  await page.selectOption('#preview-mode','custom');await page.locator('#preview-width').fill('-1');await page.locator('#preview-height').fill('99999');await page.locator('#preview-custom button').click();assert.match(await page.locator('#preview-error').textContent(),/240/);
  await page.locator('#preview-width').fill('1200');await page.locator('#preview-height').fill('700');await page.locator('#preview-custom button').click();await frame.waitForFunction(()=>innerWidth===1200&&innerHeight===700);
  await page.locator('#preview-rotate').click();await frame.waitForFunction(()=>innerWidth===700&&innerHeight===1200);
  await page.selectOption('#preview-mode','desktop');await page.selectOption('#preview-zoom','actual');await frame.waitForFunction(()=>innerWidth===1440&&innerHeight===900);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{const a=document.querySelector('#article');a.scrollTo(a.scrollWidth,a.scrollHeight)});
  assert.equal(await page.evaluate(()=>document.querySelector('#article').scrollLeft>0),true);
  await page.selectOption('#preview-mode','auto');await page.waitForFunction(()=>document.body.classList.contains('preview-device'));await page.selectOption('#preview-mode','desktop');await page.waitForFunction(()=>document.body.classList.contains('preview-device'));
  assert.equal(await frame.locator('#input').inputValue(),'retained form');if(interactive)assert.equal(await frame.locator('#counter').textContent(),'1');assert.equal(await page.evaluate(()=>window.__previewLoads),originalLoads);
  if(interactive){
   await page.selectOption('#preview-mode','phone');await frame.waitForFunction(()=>innerWidth===390);await page.selectOption('#preview-zoom','fit');
   await clickInside('#modal');if(out)await page.screenshot({path:out+'/modal-click.png'});await frame.waitForFunction(()=>document.querySelector('dialog').open);const modal=await frame.locator('dialog').boundingBox();assert(modal);await clickInside('#close');
   await page.locator('.dock [data-mode="suggest"]').click();await clickInside('#repeat');await page.locator('#selection-action').click();await page.locator('#composer').waitFor({state:'visible'});await page.locator('#comment-body').fill('unsent retained composer');
   await page.selectOption('#preview-mode','desktop');await page.locator('#preview-rotate').evaluate(b=>b.click());assert.equal(await page.locator('#comment-body').inputValue(),'unsent retained composer');await page.locator('#cancel-comment').click();
  }
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('marginroom.preview.v1:synthetic')));await page.reload();await page.waitForFunction(()=>document.body.classList.contains('preview-device'));
  assert.equal(await page.locator('#preview-mode').inputValue(),saved.mode);assert.equal(await page.locator('#preview-rotate').getAttribute('aria-pressed'),String(saved.rotated));
  assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.writes,[]);await ctx.close();
 }
 if(out)await writeFile(out+'/viewport-metadata.json',JSON.stringify({cases,screenshots},null,2));
 console.log(`PASS ${cases} real static/interactive viewport combinations; media queries/vw/vh/fixed footer, stable identity/exact load counts/form+counter, rotate/custom validation, sidebar Fit, 100% pan, Auto/preset roundtrip, interactive modal/comment composer, sandbox/source isolation.`);
}finally{await browser.close()}
