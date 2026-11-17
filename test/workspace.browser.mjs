// Synthetic, GET-only workspace bounds and preview state regression.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser,isolate,syntheticFixture,openFixture} from './helpers/browser.mjs';
const out=process.env.WORKSPACE_ARTIFACTS,baseline=process.env.WORKSPACE_BASELINE==='1';
if(out)await mkdir(out,{recursive:true});
const browser=await launchBrowser(),metrics=[];
const fixture=syntheticFixture();
fixture.doc.hasRaw=true;
const html=`<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0;background:#fff;color:#263c35;font:16px/1.8 system-ui}main{max-width:800px;margin:auto;padding:36px}h1{font-size:30px}h2{border-bottom:1px solid #dde4de}input,button{font:inherit;padding:8px;max-width:100%}.diagram{background:#eef4f1;border:1px solid #b3c6bb;padding:30px;text-align:center}footer{position:fixed;bottom:0;background:#e9f0eb;padding:8px;width:100%}@media(max-width:600px){main{padding:16px}}</style></head><body><main><h1>Metal Arm | 负载预测设计 v2</h1><p>从静态负载到动态力矩：审查工作区的正文与设计图。</p><input id="input" value="initial"><button id="count">Count <span id="counter">0</span></button><div class="diagram">任务目标 → 状态估计 → 力矩预测<br>传感反馈 ← 机器人执行 ← 控制策略</div>${Array.from({length:30},(_,i)=>`<h2>Chapter ${i+1} · 负载估计与控制策略</h2><p>Review passage ${i+1}. ${'系统根据机械臂状态估计实际负载，并通过传感器反馈修正控制策略。'.repeat(7)}</p>`).join('')}</main><footer>Imported page footer · own viewport</footer><script>let n=0;document.querySelector('#count').onclick=()=>document.querySelector('#counter').textContent=++n</script></body></html>`;
fixture.doc.baseHtml=html;
try{
 const ctx=await browser.newContext({viewport:{width:1700,height:1000}}),evidence=await isolate(ctx,fixture);
 await ctx.route('**/api/raw/synthetic',r=>r.fulfill({json:{rawHtml:html}}));
 await ctx.addInitScript(()=>{if(window===top){window.loads=0;document.addEventListener('load',e=>{if(e.target.tagName==='IFRAME')loads++},true)}});
 const page=await ctx.newPage();await openFixture(page);await page.locator('#preview-dock-toggle').click();page.setDefaultTimeout(10000);
 async function settle(){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r)))))}
 async function snap(label){await settle();const m=await page.evaluate(()=>{const rect=s=>{const n=document.querySelector(s),r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,display:getComputedStyle(n).display}};return {host:innerWidth,scrollWidth:document.documentElement.scrollWidth,outerY:scrollY,workspace:rect('.workspace'),nav:rect('.nav'),discussion:rect('.discussion'),main:rect('.main'),stage:rect('#article'),root:rect('#hs-doc-root'),frame:document.querySelector('iframe')?rect('iframe'):null,scale:Number(document.querySelector('iframe')?.dataset.previewScale),articleStyle:{padding:getComputedStyle(document.querySelector('#article')).padding,border:getComputedStyle(document.querySelector('#article')).borderWidth,background:getComputedStyle(document.querySelector('#article')).backgroundColor}}});metrics.push({label,...m});if(out)await page.screenshot({path:out+'/'+label+'.png'});return m}
 await page.selectOption('#preview-mode','desktop');let frame=page.frames().find(f=>f!==page.mainFrame());await frame.waitForFunction(()=>innerWidth===1440&&innerHeight===900);await frame.locator('#input').fill('retained workspace state');await page.evaluate(()=>window.savedFrame=document.querySelector('iframe'));
 const loads=await page.evaluate(()=>window.loads);
 for(const width of [1700,1440,1024]){
  await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.body.classList.remove('nav-collapsed','drawer-closed','nav-open','drawer-open'));await settle();
  for(const state of ['expanded','collapsed']){
   if(state==='collapsed'){if(width>1100){await page.locator('#nav-toggle').click();await page.locator('.close-drawer').click()}else{await page.locator('#nav-toggle').click();await page.locator('#nav-close').click().catch(async()=>page.locator('#nav-toggle').click())}}
   for(const [mode,w,h] of [['desktop',1440,900],['tablet',768,1024]]){
    await page.selectOption('#preview-mode',mode);await frame.waitForFunction(([w,h])=>innerWidth===w&&innerHeight===h,[w,h]);await settle();const m=await snap(`${width}-${state}-${mode}`);
    assert.equal(await frame.locator('#input').inputValue(),'retained workspace state');assert.equal(await page.evaluate(()=>window.savedFrame===document.querySelector('iframe')&&window.loads===1),true);
    assert(m.scrollWidth<=width,'no shell overflow');
    if(!baseline){
     assert.equal(m.workspace.x,0);assert.equal(m.workspace.width,width);
     if(width>1100){if(state==='expanded'){assert.equal(m.nav.x,0);assert.equal(m.nav.width,240);assert.equal(m.discussion.right,width);assert.equal(m.discussion.width,320);assert.equal(m.main.width,width-560)}else assert.equal(m.main.width,width)}else assert.equal(m.main.width,width);
     assert(Math.abs(m.frame.width-w*m.scale)<1);assert(Math.abs(m.frame.height-h*m.scale)<1);assert(Math.abs(m.root.width-m.frame.width)<1);assert(Math.abs(m.root.height-m.frame.height)<1);assert.equal(m.articleStyle.border,'0px');assert.equal(m.articleStyle.padding,'12px');
     assert(m.frame.x>=m.stage.x&&m.frame.right<=m.stage.right+1);assert(m.frame.bottom<=m.stage.bottom+1);
    }
   }
  }
 }
 await page.setViewportSize({width:1700,height:1000});await page.selectOption('#preview-mode','auto');await settle();let a=await snap('1700-auto');if(!baseline)assert.equal(a.frame.width,a.stage.width-24,'Auto fills available width');
 for(const width of [390,360]){await page.setViewportSize({width,height:844});await page.selectOption('#preview-mode','desktop');await page.selectOption('#preview-zoom','fit');const m=await snap(`${width}-fit`);assert(m.scrollWidth<=width);await page.selectOption('#preview-zoom','actual');await settle();await page.evaluate(()=>document.querySelector('#article').scrollTo(9999,9999));assert(await page.evaluate(()=>document.querySelector('#article').scrollLeft>0));await snap(`${width}-pan`)}
 assert.equal(await page.evaluate(()=>window.loads),loads);assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.writes,[]);await ctx.close();
 if(out)await writeFile(out+'/metrics.json',JSON.stringify(metrics,null,2));console.log(`PASS workspace ${baseline?'baseline':'candidate'}: ${metrics.length} captures; bounds, fixed viewport/state/load identity, Auto width, mobile Fit/pan; zero writes.`);
}finally{await browser.close()}
