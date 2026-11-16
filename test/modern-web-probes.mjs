import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import http from 'node:http';
import {launchBrowser} from './helpers/browser.mjs';
import {parseFrameReady} from '../public/frame-messages.js';
const out=new URL('../../evidence/probes/',import.meta.url).pathname;await mkdir(out,{recursive:true});const results={};
for(const m of [{anchors:[{}],origText:{}},{anchors:['a','a'],origText:{}},{anchors:['a'],origText:{a:5}},{anchors:['a'],origText:{b:'bad'}},{anchors:['a'],origText:{a:'x'.repeat(1000001)}},{anchors:Array(20001).fill('a'),origText:{}}])assert.equal(parseFrameReady(m),null);
assert(parseFrameReady({anchors:['a'],origText:{a:'original'}}));assert(parseFrameReady({anchors:['a','b'],origText:{a:'original',b:'newly revealed'}}));results.schema={malformedRejected:6,validRescanAccepted:true};
const before=execFileSync('git',['show','ddc0c61:public/review-v3.js'],{encoding:'utf8'}),after=await readFile(new URL('../public/review-v3.js',import.meta.url),'utf8');
for(const [name,source] of [['before',before],['after',after]]){
 const code=source.slice(source.indexOf('async function poll(){'),source.indexOf('async function loadedIdentity'));
 let count=0;const ctx={polling:false,document:{hidden:true,activeElement:{}},localEditing:()=>false,selectionPress:null,selectionInfo:()=>null,busy:false,composing:false,editTimers:new Map(),editInflight:0,root:{contains:()=>false},mode:'read',docId:'fixture',overlaySignature:'{}',state:()=>({canEdit:true,canSuggest:true}),fetch:async()=>{count++;return {ok:true,json:async()=>({overlay:{},canEdit:true,canSuggest:true})}},refresh:async()=>{},encodeURIComponent};vm.createContext(ctx);vm.runInContext(code,ctx);for(let i=0;i<3;i++)await ctx.poll();const hidden=count;ctx.document.hidden=false;await ctx.poll();results[name]={hiddenRequests:hidden,visibleRequests:count-hidden};assert.equal(hidden,name==='before'?3:0);assert.equal(count-hidden,1);
}
const captured=[];const sink=http.createServer((req,res)=>{captured.push({url:req.url,referer:req.headers.referer||''});res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')});await new Promise(r=>sink.listen(0,'127.0.0.1',r));const target='http://127.0.0.1:'+sink.address().port;
const host=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html','Referrer-Policy':'strict-origin-when-cross-origin'});res.end('<button id="shell">Shell sentinel</button><div id="hs-doc-root"></div>')});await new Promise(r=>host.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+host.address().port;
const browser=await launchBrowser();try{const page=await browser.newPage();await page.goto(base+'/?key=DISPOSABLE_SENTINEL_ONLY');const viewer=execFileSync('git',['show','ddc0c61:public/viewer.js'],{encoding:'utf8'});const fn=viewer.slice(viewer.indexOf('function renderBaseHtml('),viewer.indexOf('// Apply overlay text'));
await page.evaluate(({fn,target})=>{const root=document.querySelector('#hs-doc-root'),scopeCssText=s=>s;eval('('+fn+')')('<html><body><img src="'+target+'/author-image" referrerpolicy="unsafe-url"></body></html>')},{fn,target});await page.waitForTimeout(600);results.privacy={dualOrigin:true,syntheticSentinelOnly:true,requests:captured.filter(r=>r.url==='/author-image')};assert(results.privacy.requests.length);assert(results.privacy.requests.some(r=>r.referer.includes('DISPOSABLE_SENTINEL_ONLY')));
const fixed=await readFile(new URL('../public/viewer.js',import.meta.url),'utf8'),fixedFn=fixed.slice(fixed.indexOf('function renderBaseHtml('),fixed.indexOf('// Apply overlay text'));
await page.evaluate(({fn,target})=>{const root=document.querySelector('#hs-doc-root'),scopeCssText=s=>s;eval('('+fn+')')('<html><body><img src="'+target+'/fixed-image" referrerpolicy="unsafe-url"></body></html>')},{fn:fixedFn,target});await page.waitForTimeout(600);results.privacy.fixedRequests=captured.filter(r=>r.url==='/fixed-image');assert(results.privacy.fixedRequests.length);assert(results.privacy.fixedRequests.every(r=>r.referer===''));
}finally{await browser.close();await new Promise(r=>host.close(r));await new Promise(r=>sink.close(r))}
await writeFile(out+'result.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
