import {createLocale,storedLocale,supportedLocale,LOCALE_KEY} from '../public/i18n.js';
import en from '../public/locales/en.js';import zh from '../public/locales/zh-CN.js';
import assert from 'node:assert/strict';import {readFile}from'node:fs/promises';import {parse}from'parse5';
const flat=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='string'?[[p+k,v]]:flat(v,p+k+'.'));
const a=new Map(flat(en)),b=new Map(flat(zh));assert.deepEqual([...a.keys()].sort(),[...b.keys()].sort());
const slots=s=>[...s.matchAll(/{{\s*([^}]+)\s*}}/g)].map(m=>m[1]).sort();for(const [k,v]of a)assert.deepEqual(slots(v),slots(b.get(k)),k);
const store=new Map();const storage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)};
assert.equal(storedLocale(storage),'en');const l=createLocale(storage);assert.equal(l.language,'en');assert.equal(l.t('home.heading'),'Documents');
for(const [n,s]of [[0,'0 pending annotations'],[1,'1 pending annotation'],[2,'2 pending annotations']])assert.equal(l.t('home.pending',{count:n}),s);
await l.change('zh-CN');assert.equal(store.get(LOCALE_KEY),'zh-CN');assert.equal(createLocale(storage).language,'zh-CN');assert.equal(l.t('home.pending',{count:2}),'2 条未处理批注');
l.engine.addResource('en','translation','test.englishOnly','English fallback');assert.equal(l.t('test.englishOnly'),'English fallback');assert.throws(()=>l.t('missing.product.key'),/Missing shell locale key/);assert(l.missing.has('missing.product.key'));
for(const invalid of ['zh','fr','ZH-cn','null','{}','"zh-CN"',null,undefined]){assert.equal(supportedLocale(invalid),'en');store.set(LOCALE_KEY,invalid);assert.equal(createLocale(storage).language,'en')}
const denied={getItem(){throw Error('denied')},setItem(){throw Error('denied')}};const d=createLocale(denied);assert.equal(d.language,'en');await d.change('zh-CN');assert.equal(d.language,'zh-CN');await d.change('bogus');assert.equal(d.language,'en');
// Scoped migration gate: these are the migrated entry shell, not imported pages.
// Viewer/frame modules remain explicitly pending and are NOT certified here.
for(const file of ['public/index.js','public/index.html']){
 const s=await readFile(file,'utf8');assert(!/[\u3400-\u9fff]/.test(s),file+' has hardcoded Chinese shell copy');
 for(const m of s.matchAll(/(?:copy\(['"]|data-i18n(?:-[\w-]+)?=["'])([\w.]+)/g))if(m[1].includes('.'))assert(l.engine.exists(m[1],{count:2}),file+': '+m[1]);
 if(file.endsWith('.html')){
  const visit=(node,bound=false)=>{
   if(['style','script'].includes(node.tagName))return;
   const attrs=new Map((node.attrs||[]).map(a=>[a.name,a.value]));bound=bound||attrs.has('data-i18n');
   if(node.nodeName==='#text'&&/[A-Za-z]/.test(node.value)&&!bound)assert(['Marginroom',en.home.title].includes(node.value.trim()),'Unbound HTML copy: '+node.value);
   for(const attr of ['aria-label','title','placeholder'])if(attrs.has(attr)&&/[A-Za-z]/.test(attrs.get(attr)))assert(attrs.has('data-i18n-'+attr),'Unbound HTML attribute: '+attr);
   for(const child of node.childNodes||[])visit(child,bound);
  };visit(parse(s));
 }
 if(file.endsWith('.js')){
  // Bindings/descriptors are required at shell text sinks. Ignore blank strings,
  // decorative glyphs, canonical IDs, native language names and user variables.
  for(const pattern of [/\b(?:button|toast|empty|confirmBox|showDialog)\(\s*['"]([A-Za-z][^'"]*)/g,/\.textContent\s*=\s*['"]([A-Za-z][^'"]*)/g,/\.setAttribute\(['"](?:aria-label|title|placeholder)['"],\s*['"]([A-Za-z][^'"]*)/g])assert.deepEqual([...s.matchAll(pattern)].map(m=>m[1]),[],file+' has unbound product copy');
 }
}
console.log('PASS locale resources: '+a.size+' keys/locale, placeholders, English fallback, 0/1/2 plurals, missing-key failure, storage corruption/denial, persistence; scoped entry-copy gate.');

// The v3 shell/controller modules own their copy; imported product content such
// as metal-arm-plan is intentionally NOT in this scope. The legacy viewer is
// checked only for the active bridge sections; its retired UI is not served.
const migrated=['review-v3.js','preview-viewport.js','review-ranges.js','annotation-affordances.js','inline-draft.js','static-frame-controller.js','frame-controller.js','static-preview.js','assets.js','feedback.js','viewer.html'];
for(const name of migrated){
 const file='public/'+name,source=await readFile(file,'utf8');
 assert(!/[\u3400-\u9fff]/.test(source),file+' has hardcoded CJK product copy');
 if(name.endsWith('.js'))for(const re of [/\.textContent\s*=\s*['"]([A-Za-z][^'"]*)/g,/\.setAttribute\(['"](?:aria-label|title|placeholder)['"],\s*['"]([A-Za-z][^'"]*)/g,/\b(?:toast|status)\(\s*['"]([A-Za-z][^'"]*)/g])assert.deepEqual([...source.matchAll(re)].map(m=>m[1]),[],file+' has a hardcoded shell sink');
 for(const m of source.matchAll(/(?:\b(?:tr|t)\(|data-i18n(?:-[\w-]+)?=)['"]([\w]+\.[\w]+)['"]/g))assert(l.engine.exists(m[1],{count:2}),file+' missing '+m[1]);
}
for(const k of ['review.replies','frame.markerComment','frame.pendingRevision','asset.missingAssets','notice.staleEdits','notice.missedEdits'])for(const count of [0,1,2])for(const language of ['en','zh-CN']){await l.change(language);assert(!l.t(k,{count,names:'fixture'}).includes('{{'),k)}
console.log('PASS migrated viewer/frame scoped copy guard and 0/1/2 counts');

const bridgeSource=await readFile('public/viewer.js','utf8'),activeBridge=bridgeSource.slice(bridgeSource.indexOf('async function getFrameControllerSrc()'),bridgeSource.indexOf('// Two-choice download menu'));
assert.deepEqual([...activeBridge.matchAll(/setStatus\([^,]+,\s*['"]([A-Za-z][^'"]*)/g)].map(m=>m[1]),[],'active viewer bridge has hardcoded status copy');
assert(!/[\u3400-\u9fff]/.test(activeBridge),'active bridge has hardcoded CJK');
