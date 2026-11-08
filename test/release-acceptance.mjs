// Real npm-start process + fresh files/database/secrets. Never contacts live data.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import net from 'node:net';
import {launchBrowser} from './helpers/browser.mjs';
const dir=await mkdtemp(path.join(process.env.TMPDIR||tmpdir(),'marginroom-acceptance-'));
const secret=randomBytes(32).toString('hex'), key=randomBytes(32).toString('hex');
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const base=`http://127.0.0.1:${port}`;
let child, browser, output='';
async function start(){
 child=spawn('npm',['start'],{cwd:new URL('..',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),HS_DB_PATH:path.join(dir,'app.db'),HS_DOCS_DIR:path.join(dir,'docs'),SESSION_SECRET:secret,OWNER_KEY:key,MMW_UPLOAD_PER_HOUR:'1000'},detached:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 for(let i=0;i<150;i++){try{if((await fetch(base+'/api/whoami')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Startup failed: '+output);
}
async function stop(){if(child){process.kill(-child.pid,'SIGTERM');await new Promise(r=>child.once('exit',r));child=null;}}
async function ready(page){await page.waitForFunction(()=>document.querySelector('#hs-status')?.textContent.includes('已同步'));}
async function selectText(page,selector){await page.locator(selector).evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));});}
async function rewrite(page,selector,text){await page.locator('[data-mode="suggest"]').first().click();await page.locator(selector).click();await selectText(page,selector);await page.keyboard.insertText(text);await page.locator('#submit-draft').click();await page.waitForFunction(()=>document.querySelector('#draft-actions').hidden);}
try{
 await mkdir(path.join(dir,'docs'));
 await writeFile(path.join(dir,'identity.json'),JSON.stringify({SESSION_SECRET:secret,OWNER_KEY:key}),{mode:0o600});
 await start();browser=await launchBrowser();
 const owner=await browser.newContext({viewport:{width:1440,height:1000}}), guest=await browser.newContext({viewport:{width:1440,height:1000}});
 for(const ctx of [owner,guest])await ctx.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===base||['blob:','data:'].includes(u.protocol)?route.continue():route.abort();});
 const op=await owner.newPage(), gp=await guest.newPage();
 await op.goto(base+'/?key='+key);await op.waitForFunction(()=>!location.search.includes('key='));
 assert.equal((await owner.request.get(base+'/api/whoami').then(r=>r.json())).isOwner,true);
 const html='<!doctype html><html><head><title>Synthetic field notes</title><style>body{font:20px Georgia;max-width:700px;margin:50px auto}p{line-height:1.8}</style></head><body><h1>Synthetic field notes</h1><h2>Portable review</h2><p id="first">The first paragraph needs a revision.</p><p id="second">The second paragraph remains unchanged.</p><p id="third">Select this sentence to leave a comment.</p><p id="fourth">Pending edits are not exported.</p><img src="./images/synthetic-motion.gif" alt="Synthetic animation"></body></html>';
 // Real file chooser upload through the application UI.
 await op.locator('input[type=file]').first().setInputFiles({name:'synthetic-notes.html',mimeType:'text/html',buffer:Buffer.from(html)});
 await op.locator('input[accept="image/*"]').setInputFiles(new URL('./fixtures/synthetic-motion.gif',import.meta.url).pathname);
 await op.waitForURL('**/viewer.html?doc=synthetic-notes');await ready(op);
 // Two-frame animation uploaded through the real missing-image picker.
 const gif=await readFile(new URL('./fixtures/synthetic-motion.gif',import.meta.url));
 await op.reload();await ready(op);await op.waitForFunction(()=>document.querySelector('#hs-doc-root img')?.naturalWidth>0);
 await op.locator('#share-btn').click();await op.locator('#access-level').selectOption('suggest');await op.waitForTimeout(250);await op.locator('#share-btn').click();
 await gp.goto(base+'/viewer.html?doc=synthetic-notes');await ready(gp);
 assert.equal((await guest.request.get(base+'/api/whoami').then(r=>r.json())).isOwner,false);
 assert.equal(await gp.locator('[data-mode="edit"]').first().isDisabled(),true);
 await selectText(gp,'#third');await gp.locator('#selection-action').click();await gp.locator('#comment-body').fill('A synthetic guest comment.');await gp.locator('#send-comment').click();await gp.waitForFunction(()=>document.querySelector('#composer').hidden);
 await rewrite(gp,'#first','The first paragraph now contains accepted text.');
 assert.equal(await gp.locator('#first').getAttribute('contenteditable'),'false','pending rewrite locks paragraph');
 await op.reload();await ready(op);await op.locator('.show-discussion').first().click();await op.locator('[data-accept]').click();
 await op.waitForFunction(()=>document.querySelector('#first')?.textContent==='The first paragraph now contains accepted text.');
 await gp.reload();await ready(gp);await rewrite(gp,'#second','This change must be rejected.');
 await op.reload();await ready(op);await op.locator('.show-discussion').first().click();await op.locator('[data-reject]').click();
 await op.waitForFunction(()=>!document.querySelector('[data-reject]'));
 await gp.reload();await ready(gp);await rewrite(gp,'#fourth','Pending rewrite should never be exported.');
 await op.reload();await ready(op);
 const records=await owner.request.get(base+'/api/suggestions/synthetic-notes?status=all').then(r=>r.json());
 assert.equal(records.suggestions.length,4);assert.deepEqual(records.suggestions.map(s=>s.status).sort(),['accepted','open','open','rejected']);
 await op.locator('#more-btn').click();const downloadEvent=op.waitForEvent('download');await op.locator('#export-menu').click();const download=await downloadEvent;const downloaded=await readFile(await download.path(),'utf8');
 assert.ok(downloaded.includes('The first paragraph now contains accepted text.'));assert.ok(downloaded.includes('The second paragraph remains unchanged.'));assert.ok(!downloaded.includes('This change must be rejected.'));assert.ok(!/data-hs-|data-review-|A synthetic guest comment/.test(downloaded));
 assert.ok(downloaded.includes('Pending edits are not exported.'));assert.ok(!downloaded.includes('Pending rewrite should never be exported.'));
 const data=downloaded.match(/src="data:image\/gif;base64,([^"]+)"/);assert.ok(data,'export embeds uploaded relative GIF');assert.deepEqual(Buffer.from(data[1],'base64'),gif);
 // Reopen exported standalone file with network denied; image decodes locally.
 const exp=await owner.newPage();await exp.route('**/*',r=>r.abort());await exp.setContent(downloaded);await exp.waitForFunction(()=>document.querySelector('img').naturalWidth>0);await exp.close();
 await op.locator('#popover').evaluate(e=>e.hidden=true);await op.locator('[data-filter="all"]').click();if(process.env.GENERATE_SCREENSHOT==='1')await op.screenshot({path:new URL('../docs/screenshots/alpha-synthetic.png',import.meta.url).pathname,fullPage:false});
 await stop();await start();await op.reload();await ready(op);
 assert.equal((await owner.request.get(base+'/api/whoami').then(r=>r.json())).isOwner,true,'owner signed cookie survives process restart');
 assert.equal(await op.locator('#first').textContent(),'The first paragraph now contains accepted text.');
 const persisted=await owner.request.get(base+'/api/suggestions/synthetic-notes?status=all').then(r=>r.json());assert.equal(persisted.suggestions.length,4);
 assert.deepEqual(await owner.request.get(base+'/docs/assets/synthetic-motion.gif').then(r=>r.body()),gif);
 console.log('PASS real npm start: synthetic UI upload, relative animated GIF, owner cookie, anonymous comment/suggest, pending lock, UI accept/reject, clean self-contained export, process restart/persistence.');
}finally{await browser?.close();await stop();await rm(dir,{recursive:true,force:true});}
