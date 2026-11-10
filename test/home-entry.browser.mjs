// Real isolated service/browser acceptance. Run: node test/home-entry.browser.mjs
// ENTRY_RUNTIME selects a separate runtime tree (server, DB module and real public).
// No API responses are mocked. Only the optional git-original static-index baseline
// is substituted server-side; all current acceptance uses the actual runtime assets.
import assert from 'node:assert/strict';
import {randomBytes, createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import express from 'express';
import {launchBrowser} from './helpers/browser.mjs';

const workspace = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const runtime = path.resolve(process.env.ENTRY_RUNTIME || workspace);
const artifacts = path.join(workspace, 'review-artifacts/entry');
await mkdir(artifacts, {recursive:true});
const scratch = await mkdtemp(path.join(artifacts, '.synthetic-'));
const docs = path.join(scratch, 'docs');
await mkdir(docs);
// Set before any runtime import; never reuse the process's live credentials/DB/docs.
process.env.HS_DOCS_DIR = docs;
process.env.OWNER_KEY = randomBytes(32).toString('hex');
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
process.env.NODE_ENV = 'test';
process.env.MMW_GUEST_DOC_LIMIT = '1';
process.env.MMW_READ_PER_MIN = '10000';
process.env.MMW_WRITE_PER_MIN = '1000';
process.env.MMW_UPLOAD_PER_HOUR = '1000';
const {openDb} = await import(pathToFileURL(path.join(runtime, 'db.js')));
const {createApp} = await import(pathToFileURL(path.join(runtime, 'server.js')));
const db = openDb(path.join(scratch, 'synthetic.sqlite'));
let original = null, baseline = false;
try { original = execFileSync('git', ['show','3c971e4490b8139869e27dcc7ee0c94156a1a812:public/index.html'], {cwd:workspace, encoding:'utf8'}); } catch {}
const app = express();
app.get('/', (req,res,next) => baseline && original ? res.type('html').send(original) : next());
app.use(createApp(db));
const server = await new Promise(resolve => {const s = app.listen(0,'127.0.0.1',()=>resolve(s));});
const origin = `http://127.0.0.1:${server.address().port}`;
const report = {runtime, isolated:true, mockedAPIs:0, baseline:null, checks:[], screenshots:[], issues:[]};
const errors = [], dialogs = [], external = [], requests = [];
let browser;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const longHTML = '<!doctype html><html><head><title>Ocean synthetic manuscript</title><style>body{margin:30px;font:18px/1.7 sans-serif}p{margin:30px 0}</style></head><body><h1>Ocean synthetic manuscript</h1><img src="entry-pixel.png" alt="Synthetic pixel">' + Array.from({length:100},(_,i)=>`<p>Section ${i}. ${'Synthetic reading text, never a live document. '.repeat(12)}</p>`).join('') + '</body></html>';
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
async function context(options={}) {
 const ctx = await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,...options});
 // Network isolation only: same-origin traffic reaches the real service untouched.
 await ctx.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) { external.push(`${route.request().method()} ${url.origin}${url.pathname}`); return route.abort(); }
  if(!baseline)requests.push({method:route.request().method(),path:url.pathname,scope:url.searchParams.get('scope')});
  return route.continue();
 });
 ctx.on('page', p => {
  p.setDefaultTimeout(15000);
  p.on('pageerror', e => {if(baseline) {report.baselineErrors ??= [];report.baselineErrors.push(e.message);} else errors.push(e.message);});
  p.on('dialog', async d => {dialogs.push(d.type()); await d.dismiss();});
 });
 return ctx;
}
async function home(page) {
 await page.goto(origin + '/');
 await page.waitForFunction(()=>document.querySelector('#rows')?.getAttribute('aria-busy')==='false');
}
async function settled(page) { await page.waitForFunction(()=>document.querySelector('#rows')?.getAttribute('aria-busy')==='false'); }
async function reader(page,id) {
 await page.waitForURL(url=>url.pathname==='/viewer.html'&&url.searchParams.get('doc')===id);
 await page.waitForFunction(()=>document.querySelector('#hs-status')?.textContent.includes('已同步'));
 await page.locator('iframe.hs-static-preview').waitFor({state:'visible'});
 const f = await page.locator('iframe.hs-static-preview').elementHandle().then(el=>el.contentFrame());
 assert.ok(f,'real static sandbox frame exists');
 await f.waitForFunction(()=>document.querySelector('[data-hs-anchor]'));
 // The validated controller marks synced blocks, not merely the first frame paint.
 await f.waitForFunction(()=>document.querySelector('[data-hs-anchor]')?.hasAttribute('contenteditable'));
 return f;
}
async function paste(page,id,html) {
 await page.locator('#import').click();
 await page.locator('details.paste summary').click();
 await page.locator('#source').fill(html);
 await page.locator('#paste-id').fill(id);
 await page.locator('#doImport').click();
}
const row = (page,id) => page.locator('.row').filter({has:page.locator(`a[href="/viewer.html?doc=${id}"]`)});
async function menu(page,id,label) {await row(page,id).locator('.more').click();await page.locator('.menu').getByRole('button',{name:label,exact:true}).click();}
async function api(ctx,url) {const response=await ctx.request.get(origin+url);return {status:response.status(),body:await response.json()};}
async function check(name,fn) {
 try {await fn();report.checks.push(name);console.log('PASS '+name);}
 catch(e) {const message=String(e.message).split(process.env.OWNER_KEY).join('[REDACTED]').slice(0,2400);report.issues.push({check:name,message});console.error('FAIL '+name+': '+message);process.exitCode=1;}
}
try {
 browser = await launchBrowser();
 if(original) {
  const ctx=await context(), p=await ctx.newPage();baseline=true;
  await p.goto(origin+'/');
  // Assert the new entry contract against git's original, without editing public.
  let failed=false;
  try {assert.equal(await p.locator('#recent').count(),1,'original lacks recent-document entry contract');} catch {failed=true;}
  report.baseline={expectedFailure:failed,sha256:sha(original)};
  await p.screenshot({path:path.join(artifacts,'git-original-home.png'),fullPage:false});
  await ctx.close();baseline=false;
  assert.ok(failed,'git original should fail new-home contract');
 }
 const admin=await context();
 // Bootstrap through the real endpoint without placing a secret in a URL/log.
 const promoted=await admin.request.get(origin+'/api/whoami',{headers:{'x-owner-key':process.env.OWNER_KEY}});
 assert.equal((await promoted.json()).isOwner,true);
 const page=await admin.newPage();
 await check('native responsive home/import screenshots and geometry',async()=>{
  await home(page);
  for(const width of [1440,1024,390,360]) {
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`home overflow ${width}`);
   for(const id of ['#import','#recent','#mine','#search'])assert.ok(await page.locator(id).isVisible());
   for(const kind of ['home','import']) {
    if(kind==='import')await page.locator('#import').click();
    const file=`${kind}-${width}.png`;
    await page.screenshot({path:path.join(artifacts,file),fullPage:false,animations:'disabled'});
    report.screenshots.push({file,width,height:1000,deviceScaleFactor:1});
    if(kind==='import') {
     const b=await page.locator('#modal').boundingBox();assert.ok(b.x>=0&&b.x+b.width<=width+1,`modal overflow ${width}`);
     await page.locator('#modalClose').click();
    }
   }
  }
  await page.setViewportSize({width:1440,height:1000});
 });
 await check('HTML file + selected local image imports through real APIs and disk',async()=>{
  await page.locator('#import').click();
  await page.locator('#htmlFile').setInputFiles({name:'ocean.html',mimeType:'text/html',buffer:Buffer.from(longHTML)});
  await page.locator('#images').setInputFiles({name:'entry-pixel.png',mimeType:'image/png',buffer:pixel});
  await page.locator('#doImport').click();
  await reader(page,'ocean');
  assert.equal(await readFile(path.join(docs,'ocean.html'),'utf8'),longHTML);
  assert.deepEqual(await readFile(path.join(docs,'assets/entry-pixel.png')),pixel);
  assert.equal((await api(admin,'/api/doc-meta/ocean')).body.title,'Ocean synthetic manuscript');
  const frame=page.frames().find(f=>f!==page.mainFrame());
  await frame.waitForFunction(()=>document.querySelector('img')?.complete&&document.querySelector('img').naturalWidth===1);
  assert.equal(await page.locator('iframe.hs-static-preview').getAttribute('sandbox'),'allow-scripts');
 });
 await check('reader brand return and actual inner sandbox reading restoration across navigation',async()=>{
  await page.locator('#preview-mode').selectOption('desktop');
  await page.locator('#preview-zoom').selectOption('actual');
  const frame=await reader(page,'ocean');
  await frame.evaluate(()=>scrollTo(0,1300));
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('marginroom.reading.v1:ocean')||'null')?.content?.y===1300);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('marginroom.reading.v1:ocean')));
  assert.ok(saved.content.anchor);assert.ok(!JSON.stringify(saved).includes('Synthetic reading text'));
  await page.locator('#viewer-home').click();await page.waitForURL(origin+'/');await settled(page);
  assert.equal(await row(page,'ocean').count(),1);
  await row(page,'ocean').locator('a.doc').click();
  const restored=await reader(page,'ocean');await restored.waitForFunction(()=>scrollY===1300);
  await restored.evaluate(()=>scrollTo(0,1600));
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('marginroom.reading.v1:ocean')||'null')?.content?.y===1600);
  assert.equal(await restored.evaluate(()=>scrollY),1600,'restore must not repeatedly fight reading');
 });
 await check('paste import and duplicate keep-both preserve original and independent identity',async()=>{
  await home(page);await paste(page,'ocean','<!doctype html><title>Independent copy</title><p>Synthetic duplicate copy.</p>');
  await page.getByRole('button',{name:'保留两份',exact:true}).click();
  await reader(page,'ocean-2');
  assert.equal(await readFile(path.join(docs,'ocean.html'),'utf8'),longHTML);
  assert.match(await readFile(path.join(docs,'ocean-2.html'),'utf8'),/Independent copy/);
  assert.notEqual(db.prepare('SELECT doc_id FROM doc_owners WHERE doc_id=?').get('ocean'),undefined);
 });
 const guest=await context(), gp=await guest.newPage();
 await check('unauthorized replace denied in modal with original file and SQLite owner unchanged',async()=>{
  const before=sha(await readFile(path.join(docs,'ocean.html')));
  const ownerBefore=db.prepare('SELECT * FROM doc_owners WHERE doc_id=?').get('ocean');
  await home(gp);await paste(gp,'ocean','<!doctype html><title>Denied replacement</title><p>Not mine.</p>');
  await gp.getByRole('button',{name:'替换',exact:true}).click();
  await gp.waitForFunction(()=>document.querySelector('#importError')?.textContent.includes('不属于'));
  assert.equal(sha(await readFile(path.join(docs,'ocean.html'))),before);
  assert.deepEqual(db.prepare('SELECT * FROM doc_owners WHERE doc_id=?').get('ocean'),ownerBefore);
  await gp.locator('#modalClose').click();await gp.locator('#modalClose').click();
 });
 const literal='<img src=x onerror=window.TITLE_RAN=true> & Synthetic';
 await check('mine is caller-owned only; real title XSS is inert and title search filters',async()=>{
  await paste(gp,'guest-title','<!doctype html><title>&lt;img src=x onerror=window.TITLE_RAN=true&gt; &amp; Synthetic</title><p>Guest content.</p>');
  await gp.waitForURL(url=>url.searchParams.get('doc')==='guest-title');
  await gp.waitForFunction(()=>document.querySelector('#hs-status')?.textContent.includes('已同步'));
  await gp.locator('#viewer-home').click();await gp.waitForURL(origin+'/');await settled(gp);
  const actualTitle=await row(gp,'guest-title').locator('.title').textContent();
  assert.equal(await gp.evaluate(()=>window.TITLE_RAN),undefined);
  assert.equal(await row(gp,'guest-title').locator('.title img').count(),0);
  await gp.locator('#mine').click();await settled(gp);
  assert.deepEqual((await api(guest,'/api/docs?scope=mine')).body.docs,['guest-title']);
  assert.equal(await gp.locator('.row').count(),1);
  await gp.locator('#search').fill('Synthetic');assert.equal(await gp.locator('.row').count(),1);
  await gp.locator('#search').fill('Ocean');assert.equal(await gp.locator('.row').count(),0);
  await gp.reload();await settled(gp);assert.equal(await gp.locator('#search').inputValue(),'Ocean');
  await gp.locator('#search').fill('');
  await home(page);await page.locator('#mine').click();await settled(page);
  assert.deepEqual((await api(admin,'/api/docs?scope=mine')).body.docs,['ocean','ocean-2']);
  assert.equal(await row(page,'guest-title').count(),0,'admin authority does not make foreign document mine');
  assert.equal(actualTitle,literal,'canonical title text must preserve escaped markup literally');
 });
 await check('default real guest limit remains one while admin keeps independent copies',async()=>{
  const denied=await guest.request.post(origin+'/api/upload',{data:{id:'guest-limit-denied',html:'<title>Denied second</title><p>Synthetic</p>',overwrite:false}});
  assert.equal(denied.status(),403);assert.equal((await denied.json()).error,'guest_doc_limit');
  assert.equal((await api(guest,'/api/doc-meta/guest-limit-denied')).status,404);
 });
 await check('share gives clean direct viewer URL and independent guest reads without ownership',async()=>{
  await menu(page,'ocean','分享文稿链接');
  const link=await page.locator('.sharelink').inputValue();
  assert.equal(link,origin+'/viewer.html?doc=ocean');assert.equal(new URL(link).searchParams.has('key'),false);
  await page.locator('#modalClose').click();
  const shared=await context(), sp=await shared.newPage();await sp.goto(link);await reader(sp,'ocean');
  assert.equal((await api(shared,'/api/doc-meta/ocean')).body.canDelete,false);
  await sp.locator('#viewer-home').click();await sp.waitForURL(origin+'/');await settled(sp);
  assert.equal(await row(sp,'ocean').count(),1);
  await sp.locator('#mine').click();await settled(sp);assert.equal(await sp.locator('.row').count(),0);
  await shared.close();
 });
 await check('local remove never deletes; explicit server delete removes file, API and ownership',async()=>{
  await page.locator('#recent').click();await settled(page);
  await menu(page,'ocean-2','移出最近打开');await page.getByRole('button',{name:'移出记录',exact:true}).click();await settled(page);
  assert.equal(await row(page,'ocean-2').count(),0);
  assert.equal((await api(admin,'/api/doc-meta/ocean-2')).status,200);
  assert.match(await readFile(path.join(docs,'ocean-2.html'),'utf8'),/Independent copy/);
  await page.locator('#mine').click();await settled(page);await menu(page,'ocean-2','删除文稿…');
  await page.getByRole('button',{name:'删除文稿',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#toast')?.textContent==='文稿已删除');await settled(page);
  assert.equal((await api(admin,'/api/doc-meta/ocean-2')).status,404);
  await assert.rejects(readFile(path.join(docs,'ocean-2.html')), {code:'ENOENT'});
  assert.equal(db.prepare('SELECT * FROM doc_owners WHERE doc_id=?').get('ocean-2'),undefined);
 });
 await check('corrupt/blocked storage and stale IDs remain usable with real service',async()=>{
  for(const mode of ['corrupt','blocked','stale']) {
   const ctx=await context();
   await ctx.addInitScript(({mode,origin})=>{
    if(location.origin!==origin||window!==top)return;
    if(mode==='blocked') {for(const key of ['getItem','setItem','removeItem'])Storage.prototype[key]=()=>{throw new DOMException('Storage blocked','SecurityError')};return;}
    if(sessionStorage.getItem('entry-test-initialized'))return;
    sessionStorage.setItem('entry-test-initialized','1');
    if(mode==='corrupt') {localStorage.setItem('marginroom.recent.v1','bad JSON');localStorage.setItem('marginroom.reading.v1:ocean','bad JSON');sessionStorage.setItem('marginroom.home.v1','bad JSON');}
    else localStorage.setItem('marginroom.recent.v1',JSON.stringify({version:1,entries:[{id:'stale-missing',title:'Stale synthetic'},{id:'ocean',title:'Old title'}]}));
   },{mode,origin});
   const p=await ctx.newPage();await home(p);
   if(mode==='stale') {assert.equal(await row(p,'stale-missing').count(),1);assert.match(await row(p,'stale-missing').textContent(),/不可用/);assert.equal(await row(p,'ocean').locator('.title').textContent(),'Ocean synthetic manuscript');}
   await p.locator('#import').click();assert.ok(await p.locator('#source').count());await p.locator('#modalClose').click();
   await p.goto(origin+'/viewer.html?doc=ocean');await reader(p,'ocean');
   await p.locator('#viewer-home').click();await p.waitForURL(origin+'/');await settled(p);
   if(mode!=='blocked')assert.equal(await row(p,'ocean').count(),1);
   await ctx.close();
  }
 });
 await check('populated long-title rows match native approved layout at four sizes',async()=>{
  const titles=['海边观测站网页','城市慢行路线评审','产品发布稿','在海岸与城市之间：关于公共步道、社区花园与日常生活的观察记录','街角图书馆 · 秋季阅读计划'];
  for (let i=0;i<titles.length;i++) {
   const id='visual-'+i;
   const r=await admin.request.post(origin+'/api/upload',{data:{id,html:`<!doctype html><title>${titles[i]}</title><h1>${titles[i]}</h1><p>Synthetic visual fixture only.</p>`,overwrite:false}});
   assert.equal(r.status(),200);
   await page.goto(origin+'/viewer.html?doc='+id);await reader(page,id);
  }
  await page.locator('#viewer-home').click();await page.waitForURL(origin+'/');await settled(page);
  await page.locator('#recent').click();await settled(page);
  for (const width of [1440,1024,390,360]) {
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   const file=`populated-${width}.png`;
   await page.screenshot({path:path.join(artifacts,file),fullPage:false});report.screenshots.push({file,width,height:1000,deviceScaleFactor:1});
  }
  if(process.env.ENTRY_APPROVED_PREVIEW) {
   const reference=await browser.newContext({deviceScaleFactor:1});const rp=await reference.newPage();
   await rp.goto(pathToFileURL(path.resolve(process.env.ENTRY_APPROVED_PREVIEW)).href);
   for (const width of [1440,1024,390,360]) {await rp.setViewportSize({width,height:1000});await rp.screenshot({path:path.join(artifacts,`approved-${width}.png`),fullPage:false})}
   await reference.close();
  }
 });
 await check('native dialogs, browser errors, external traffic and global discovery absent',async()=>{
  assert.deepEqual(dialogs,[],'native alert/confirm/prompt prohibited');
  assert.deepEqual(errors,[],'uncaught browser errors');
  assert.deepEqual(external,[],'no external requests allowed');
  assert.ok(requests.filter(r=>r.path==='/api/docs').every(r=>r.scope==='mine'),'home must never globally enumerate documents');
 });
 report.requestCount=requests.length;
 await guest.close();await admin.close();
 console.log(`${report.issues.length ? 'FAIL' : 'PASS'} ${report.checks.length} passed real-service browser scenarios, ${report.issues.length} failures; ${report.screenshots.length} native screenshots; no mocked APIs, native dialogs, external requests or browser errors.`);
} catch(e) {
 console.error('FAIL '+String(e.message).split(process.env.OWNER_KEY).join('[REDACTED]'));
 process.exitCode=1;
} finally {
 await browser?.close();
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 db.close();await rm(scratch,{recursive:true,force:true});
 await writeFile(path.join(artifacts,'browser-report.json'),JSON.stringify(report,null,2)+'\n');
}
