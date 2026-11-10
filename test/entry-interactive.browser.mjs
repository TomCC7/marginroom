// Real loopback service, disposable DB/docs/identity, no API mocks.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {launchBrowser} from './helpers/browser.mjs';
import {tmpdir} from 'node:os';
const scratch=await mkdtemp(path.join(process.env.TMPDIR || tmpdir(),'entry-interactive-'));
await mkdir(path.join(scratch,'docs'));
process.env.HS_DOCS_DIR=path.join(scratch,'docs');
process.env.OWNER_KEY=randomBytes(32).toString('hex');
process.env.SESSION_SECRET=randomBytes(32).toString('hex');
process.env.NODE_ENV='test';
process.env.MMW_READ_PER_MIN='10000';
const {openDb}=await import('../db.js');
const {createApp}=await import('../server.js');
const db=openDb(path.join(scratch,'test.sqlite'));
const server=await new Promise(resolve=>{const s=createApp(db).listen(0,'127.0.0.1',()=>resolve(s))});
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
 browser=await launchBrowser();const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),errors=[],external=[];
 ctx.on('page',p=>{p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message))});
 await ctx.route('**/*',r=>{if(new URL(r.request().url()).origin!==origin){external.push(r.request().url());return r.abort()}return r.continue()});
 await ctx.request.get(origin+'/api/whoami',{headers:{'x-owner-key':process.env.OWNER_KEY}});
 const html='<!doctype html><title>Interactive private reading</title><style>body{margin:0;width:2400px;min-height:9000px}p{height:100px}</style><input id="private-form"><p id="target">Synthetic source private prose.</p><div id="app"></div><script>window.boots=(window.boots||0)+1;setTimeout(()=>{document.querySelector("#app").textContent="Delayed private generated text"},180);</script>';
 const uploaded=await ctx.request.post(origin+'/api/upload',{data:{id:'interactive-reading',html,overwrite:false}});assert.equal(uploaded.status(),200,await uploaded.text());
 const sourceBefore=await readFile(path.join(scratch,'docs/interactive-reading.html'),'utf8');
 const rawBefore=await ctx.request.get(origin+'/api/raw/interactive-reading').then(r=>r.json());
 assert.equal(rawBefore.rawHtml,html);
 const page=await ctx.newPage(),key='marginroom.reading.v1:interactive-reading';
 async function reader(){
  await page.waitForFunction(()=>document.querySelector('#hs-status')?.textContent.includes('已同步'));
  await page.waitForFunction(()=>document.querySelector('iframe')?.dataset.previewScale);
  const frame=await page.locator('#hs-doc-root iframe').elementHandle().then(el=>el.contentFrame());
  await frame.waitForFunction(()=>document.querySelector('#target')?.hasAttribute('data-hs-anchor'));
  await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.content!==undefined&&JSON.parse(localStorage.getItem(key)||'null')?.content!==null,key);
  return frame;
 }
 const stored=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
 const rows=()=>ctx.request.get(origin+'/api/suggestions/interactive-reading?status=all').then(r=>r.json()).then(j=>j.suggestions);
 await page.goto(origin+'/viewer.html?doc=interactive-reading');let frame=await reader();
 assert.equal(await page.locator('#hs-doc-root iframe').getAttribute('sandbox'),'allow-scripts');
 assert.equal(await frame.evaluate(()=>{try{return parent.document.body?'escaped':'bad'}catch{return 'isolated'}}),'isolated');
 const anchor=await frame.locator('#target').getAttribute('data-hs-anchor');
 const submitted=await ctx.request.post(origin+'/api/suggest/interactive-reading',{data:{kind:'comment',author:'Synthetic',anchor,baseText:'Synthetic source private prose.',quote:'Synthetic',body:'Persisted submitted review',rangeStart:0,rangeEnd:9}});assert.equal(submitted.status(),200,await submitted.text());
 const before=await rows();assert.equal(before.length,1);
 await frame.locator('#private-form').fill('PRIVATE_TYPED_FORM_NOT_READING_STATE');
 await page.locator('#preview-mode').selectOption('desktop');await page.locator('#preview-zoom').selectOption('actual');
 await frame.evaluate(()=>scrollTo(320,1500));await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.content?.y===1500,key);
 assert.deepEqual((await stored()).content,{x:320,y:1500});
 await page.locator('#article').evaluate(el=>el.scrollTo(80,50));await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.article?.x===80,key);
 const saved=await stored();
 // Same-frame messages are untrusted: reject nonnumeric/nonfinite/oversized data.
 for(const position of [{x:'1',y:99},{x:NaN,y:99},{x:0,y:Infinity},{x:0,y:1e7+1},null])await frame.evaluate(position=>parent.postMessage({type:'entry-reading-position',position},'*'),position);
 await page.evaluate(()=>postMessage({type:'entry-reading-position',position:{x:1,y:99}},'*'));
 await page.waitForTimeout(250);assert.deepEqual((await stored()).content,saved.content);
 // Unknown private fields are discarded, not persisted, even from the right frame.
 await frame.evaluate(()=>parent.postMessage({type:'entry-reading-position',position:{x:320,y:1500,anchor:'PRIVATE_ANCHOR',forms:'PRIVATE_TYPED_FORM_NOT_READING_STATE',source:'PRIVATE_SOURCE'}},'*'));
 await page.waitForTimeout(250);assert.deepEqual((await stored()).content,{x:320,y:1500});
 assert.equal(await frame.locator('#private-form').inputValue(),'PRIVATE_TYPED_FORM_NOT_READING_STATE');
 assert.equal(await frame.evaluate(()=>window.boots),1);
 await page.locator('#viewer-home').click();await page.waitForURL(origin+'/');await page.waitForFunction(()=>document.querySelector('#rows')?.getAttribute('aria-busy')==='false');
 await page.locator('.row a.doc[href="/viewer.html?doc=interactive-reading"]').click();frame=await reader();
 await frame.waitForFunction(()=>scrollX===320&&scrollY===1500);
 assert.deepEqual(await page.locator('#article').evaluate(el=>({x:el.scrollLeft,y:el.scrollTop})),saved.article);
 assert.equal(await frame.locator('#private-form').inputValue(),'','typed source form was not restored');
 assert.deepEqual(await rows(),before,'submitted review remains unchanged');
 assert.equal(await readFile(path.join(scratch,'docs/interactive-reading.html'),'utf8'),sourceBefore);
 assert.deepEqual(await ctx.request.get(origin+'/api/raw/interactive-reading').then(r=>r.json()),rawBefore);
 await frame.evaluate(()=>scrollTo(420,2100));await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.content?.y===2100,key);
 await page.locator('#preview-mode').selectOption('laptop');await frame.waitForFunction(()=>scrollY===2100);
 // A duplicate restore must not fight subsequent reader movement.
 await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'entry-reading-restore',position:{x:0,y:0}},'*'));
 await page.waitForTimeout(250);assert.equal(await frame.evaluate(()=>scrollY),2100);
 const serialized=await page.evaluate(key=>localStorage.getItem(key),key);
 for(const privateValue of ['PRIVATE_','Synthetic source','Delayed private','Persisted submitted'])assert.ok(!serialized.includes(privateValue));
 // Stored values within protocol bounds still clamp to actual document maxima.
 await page.locator('#viewer-home').click();await page.waitForURL(origin+'/');
 await page.evaluate(key=>{const v=JSON.parse(localStorage.getItem(key));v.content={x:1e7,y:1e7};localStorage.setItem(key,JSON.stringify(v))},key);
 await page.goto(origin+'/viewer.html?doc=interactive-reading');frame=await reader();
 await frame.waitForFunction(()=>scrollY===document.scrollingElement.scrollHeight-document.scrollingElement.clientHeight&&scrollX===document.scrollingElement.scrollWidth-document.scrollingElement.clientWidth);
 assert.deepEqual(await rows(),before);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await ctx.close();console.log('PASS real-service interactive inner x/y + stage restoration across home; numeric-only source-checked messages; finite/bounds rejection; one-shot final-geometry restore and actual-max clamping; opaque sandbox isolation; typed forms/private generated text not stored/restored; source and submitted reviews unchanged; no API mocks/external traffic/browser errors.');
} finally {
 await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();await rm(scratch,{recursive:true,force:true});
}
