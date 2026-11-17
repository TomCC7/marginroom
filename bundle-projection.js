import {parse,serialize} from 'parse5';
import {moduleImports,resourcePath,ImportError} from './document-imports.js';
// A served projection only: originals, hashes and exported source stay byte-identical.
// Rewrite declared URLs, never arbitrary strings or dynamic fetch/routing code.
export function bundleProjection(text,name,base){
 const url=raw=>{
  if(!raw||!raw.startsWith('/')||raw.startsWith('//'))return raw;
  const target=resourcePath(raw,name);return base+target+raw.slice(raw.split(/[?#]/)[0].length);
 };
 const css=t=>t.replace(/url\(\s*(['"]?)([^'"\s)]+)\1\s*\)|@import\s+(['"])([^'"]+)\3/gi,(all,q,u,q2,u2)=>u?`url("${url(u)}")`:`@import "${url(u2)}"`);
 const js=t=>{const edits=moduleImports(t).map(i=>({s:i.s,e:i.e,value:i.d>=0?JSON.stringify(url(i.n)):url(i.n)}));for(const e of edits.sort((a,b)=>b.s-a.s))t=t.slice(0,e.s)+e.value+t.slice(e.e);return t;};
 if(/\.css$/i.test(name))return css(text);
 if(/\.m?js$/i.test(name))return js(text);
 if(!/\.html?$/i.test(name))return text;
 const doc=parse(text);
 const walk=n=>{
  if(n.tagName==='base')throw new ImportError('base_element_not_supported');
  for(const a of n.attrs||[]){if(['src','poster'].includes(a.name)||(a.name==='href'&&['link','image','use'].includes(n.tagName)))a.value=url(a.value);
   else if(a.name==='style')a.value=css(a.value);
   else if(a.name==='srcset'&&!a.value.trim().startsWith('data:'))a.value=a.value.split(',').map(s=>s.replace(/^(\s*)(\S+)/,(_,ws,u)=>ws+url(u))).join(',');}
  if(n.tagName==='style')for(const c of n.childNodes||[])if(c.nodeName==='#text')c.value=css(c.value);
  if(n.tagName==='script'&&!(n.attrs||[]).some(a=>a.name==='type'&&!/^(?:module|(?:text|application)\/(?:java|ecma)script)$/i.test(a.value)))for(const c of n.childNodes||[])if(c.nodeName==='#text')c.value=js(c.value).replace(/<\/script/gi,'<\\/script');
  for(const c of n.childNodes||[])walk(c);if(n.content)walk(n.content);
 };walk(doc);return serialize(doc);
}
