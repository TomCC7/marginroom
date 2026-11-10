// Static previews retain the Article DOM as the sole storage/anchor authority.
import {elementReview} from './element-review.js';
import {readingPosition,sanitizeReading} from './entry-reading.js';
import {sha256hex} from './anchoring.js';
import {singleBlockRange,difference} from './review-ranges.js';
import {inlineDraftController,inlineDraftCSS} from './inline-draft.js';
import {annotationAffordances} from './annotation-affordances.js';
export function sanitizeStatic(doc) {
 doc.querySelectorAll('script,iframe,frame,frameset,object,embed,base,meta,template,animate,animateMotion,animateTransform,set').forEach(n=>n.remove());
 for(const el of doc.querySelectorAll('*'))for(const a of [...el.attributes]){
  const n=a.localName.toLowerCase(),v=a.value.replace(/[\u0000-\u0020\u007f]/g,'');
  if(n.startsWith('on')||n==='srcdoc'||(['href','src','action','formaction','data','xlink:href'].includes(n)&&/^(javascript|vbscript|data:text\/html):/i.test(v)))el.removeAttributeNode(a);
 }
 return doc;
}
export function createStaticPreview({docId,bridge,root,onMessage,getMode=()=> 'read'}) {
 let frame=null,active=false,ready=false,source=null,boot=null,suspended=null,captureId=0;
 const captures=new Map();
 const token=[...crypto.getRandomValues(new Uint32Array(4))].map(n=>n.toString(16).padStart(8,'0')).join('');
 const send=data=>{if(ready)frame.contentWindow.postMessage({channel:'static-preview',token,...data},'*')};
 const controls=()=>[...root.querySelectorAll('input,textarea,select')];
 const formState=()=>controls().map(n=>({value:n.value,checked:n.checked,selected:n.tagName==='SELECT'?[...n.options].map(o=>o.selected):null}));
 function applyForms(values){if(!Array.isArray(values))return;controls().forEach((n,i)=>{const v=values[i];if(!v||typeof v.value!=='string')return;n.value=v.value;n.checked=v.checked===true;if(n.tagName==='SELECT'&&Array.isArray(v.selected))[...n.options].forEach((o,j)=>o.selected=v.selected[j]===true)})}
 const blocks=()=>[...bridge.state.anchorMap,...bridge.state.commentMap].map(([anchor,el])=>({anchor,html:el.innerHTML,editable:el.contentEditable,title:el.title,thread:el.dataset.reviewBlockThread||''}));
 function sync(){send({type:'sync',blocks:blocks(),mode:getMode()})}
 window.addEventListener('message',e=>{
  const m=e.data;
  if(!frame||e.source!==frame.contentWindow||e.origin!=='null'||!m||m.channel!=='static-preview'||m.token!==token||typeof m.type!=='string')return;
  if(m.type==='ready'){ready=true;sync();frame.dispatchEvent(new Event('static-preview-ready'));return}
  if(m.type==='suspended'){applyForms(m.forms);suspended?.();suspended=null;return}
  if(!active)return;
  if(m.anchor!==undefined&&(typeof m.anchor!=='string'||m.anchor.length>256||!bridge.state.anchorMap.has(m.anchor)&&!bridge.state.commentMap.has(m.anchor)&&!/^c(?:2:[a-f0-9]{64}|3:[a-f0-9]{64}:(?:self|[0-9a-z]+(?:\.[0-9a-z]+)*))$/.test(m.anchor)))return;
  if(m.type==='reading-position'){const position=sanitizeReading(m.position);if(position)onMessage({type:m.type,position});return}
  if(['inline-change','inline-key','input','selection','comment','thread','key','located','elementTarget','targetCleared','targetMissing'].includes(m.type))onMessage(m);
  if(m.type==='selection'&&captures.has(m.requestId)){captures.get(m.requestId)(m);captures.delete(m.requestId)}
 });
 async function create(){
  source??=fetch(`/api/doc/${encodeURIComponent(docId)}`).then(async r=>{if(!r.ok)throw Error('Static preview source unavailable');return (await r.json()).baseHtml});
  const parsed=sanitizeStatic(new DOMParser().parseFromString(await source,'text/html'));
  parsed.body.replaceChildren(...[...root.childNodes].filter(n=>n!==frame).map(n=>n.cloneNode(true)));
  sanitizeStatic(parsed);
  // The source's unscoped head CSS and body attributes run at the real viewport.
  const base=parsed.createElement('base');base.href=location.href;parsed.head.prepend(base);
  const config=parsed.createElement('script');config.textContent=`window.__staticPreviewToken=${JSON.stringify(token)}`;parsed.body.append(config);
  if(docId==='metal-arm-payload-plan-v2'){
   const {enhanceMetalPlanPreview}=await import('./metal-arm-plan.js');
   await enhanceMetalPlanPreview(parsed,token,send);
  }
  const hashSource=await fetch(new URL('./anchoring.js',import.meta.url)).then(r=>r.text());
  const controller=await fetch(new URL('./static-frame-controller.js',import.meta.url)).then(r=>{if(!r.ok)throw Error('Static preview controller unavailable');return r.text()});
  const revisionSource=await fetch(new URL('./revision-diff.js',import.meta.url)).then(r=>{if(!r.ok)throw Error('Revision primitives unavailable');return r.text()});
  const script=parsed.createElement('script');script.textContent=`{${hashSource.replace(/export /g,'')}\n${revisionSource.replace(/export /g,'')}\nconst readingPosition=${readingPosition.toString()};const sanitizeReading=${sanitizeReading.toString()};const annotationAffordances=${annotationAffordances.toString()};const difference=${difference.toString()};const inlineDraftController=${inlineDraftController.toString()};const elementReview=${elementReview.toString()};const singleBlockRange=${singleBlockRange.toString()};\n${controller}\n}`;parsed.body.append(script);
  const style=parsed.createElement('style');style.textContent=inlineDraftCSS+'[data-review-mark]{background:#e0f0e5;cursor:pointer}[data-review-del]{background:#ffe3df;color:#92584e}[data-review-ins]{background:#def1e5;color:#285d48}.record-focus{outline:1px solid #76a68b}';parsed.head.append(style);
  frame=document.createElement('iframe');frame.className='hs-static-preview';frame.title='文稿设备预览';frame.setAttribute('sandbox','allow-scripts');frame.hidden=true;
  frame.srcdoc='<!doctype html>'+parsed.documentElement.outerHTML;root.append(frame);
  await new Promise((resolve,reject)=>{if(ready)return resolve();const timer=setTimeout(()=>reject(Error('Static preview controller timed out')),10000);frame.addEventListener('static-preview-ready',()=>{clearTimeout(timer);resolve()},{once:true})});
 }
 return {
  get frame(){return frame},get active(){return active},sync,
  send,
  captureSelection(){return new Promise((resolve,reject)=>{const requestId=++captureId,timer=setTimeout(()=>{captures.delete(requestId);reject(Error('选区读取失败，请重新选择'))},1500);captures.set(requestId,m=>{clearTimeout(timer);resolve(m)});send({type:'measure-selection',requestId})})},
  async setActive(value){if(value){boot??=create();await boot}else if(frame&&active){await new Promise(resolve=>{const timer=setTimeout(resolve,500);suspended=()=>{clearTimeout(timer);resolve()};send({type:'visibility',active:false})})}const wasActive=active;active=!!value;if(frame)frame.hidden=!active;if(active){sync();send({type:'visibility',active:true,forms:wasActive?null:formState()})}},
  // Called after a real document reload, not on Article/preset roundtrips.
  reconnect(){if(frame&&!frame.isConnected){ready=false;frame=null;boot=null;if(active)return this.setActive(true)}},
 };
}
