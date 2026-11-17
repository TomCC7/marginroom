import {t,bind,unbind,bindShell,onLocaleChange} from './i18n.js';
// A real iframe viewport is sized first; only its painted content is scaled.
export const PRESETS = Object.freeze({desktop:[1440,900],laptop:[1366,768],tablet:[768,1024],phone:[390,844]});
export const MIN_SIZE=240, MAX_SIZE=4096;
export function validSize(n){return Number.isInteger(n)&&n>=MIN_SIZE&&n<=MAX_SIZE}
export function preferences(value){
 const v=value&&typeof value==='object'?value:{};
 return {mode:['auto',...Object.keys(PRESETS),'custom'].includes(v.mode)?v.mode:'auto',rotated:v.rotated===true,custom:{width:validSize(v.custom?.width)?v.custom.width:1280,height:validSize(v.custom?.height)?v.custom.height:800},zoom:v.zoom==='100'?'actual':['actual','50','75','125','150','200'].includes(v.zoom)?v.zoom:'fit'};
}
export function dimensions(p){const [w,h]=PRESETS[p.mode]||[p.custom.width,p.custom.height];return p.rotated?[h,w]:[w,h]}
export function initPreview({docId,bridge,staticPreview}){
 const article=document.querySelector('#article'),root=document.querySelector('#hs-doc-root'),header=document.querySelector('.topbar');
 const key='marginroom.preview.v1:'+docId;
 let p;try{p=preferences(JSON.parse(localStorage.getItem(key)))}catch{p=preferences()}
 let currentFrame=null,changing=false,again=false,raf=0;
 const controls=document.createElement('div');controls.className='preview-controls';bind(controls,'frame.viewport',{},'aria-label');
 controls.innerHTML='<label class="sr-only" for="preview-mode" data-i18n="frame.viewport">Preview viewport</label><select id="preview-mode"><option value="auto" data-i18n="frame.auto">Auto · fill available space</option><option value="desktop">Desktop · 1440 × 900</option><option value="laptop">Laptop · 1366 × 768</option><option value="tablet">Tablet · 768 × 1024</option><option value="phone">Phone · 390 × 844</option><option value="custom" data-i18n="frame.custom">Custom size</option></select><button id="preview-rotate" title="Rotate viewport" data-i18n-title="frame.rotate" aria-label="Rotate viewport" data-i18n-aria-label="frame.rotate" type="button">↔</button><label class="sr-only" for="preview-zoom" data-i18n="frame.zoom">Preview zoom</label><select id="preview-zoom"><option value="fit" data-i18n="frame.fit">Fit</option><option value="actual">100%</option></select><output id="preview-percent" aria-live="polite"></output><form id="preview-custom" hidden><label><span data-i18n="frame.width">Width</span> <input id="preview-width" type="number" min="240" max="4096" step="1" required></label><span>×</span><label><span data-i18n="frame.height">Height</span> <input id="preview-height" type="number" min="240" max="4096" step="1" required></label><button type="submit" data-i18n="frame.apply">Apply</button><span id="preview-error" role="alert"></span></form>';
 controls.id='preview-controls';header.append(controls);bindShell(controls);
 for(const preset of ['desktop','laptop','tablet','phone'])bind(controls.querySelector(`option[value="${preset}"]`),'frame.'+preset);
 const visibilityKey='marginroom.preview-dock.v1';let dockVisible=false;
 try{dockVisible=localStorage.getItem(visibilityKey)==='visible'}catch{}
 const toggle=document.createElement('button');toggle.id='preview-dock-toggle';toggle.type='button';toggle.setAttribute('aria-controls',controls.id);
 header.insertBefore(toggle,header.querySelector('.header-tools'));
 const row=document.createElement('div');row.className='topbar-row';
 for(const node of [...header.children])if(node!==controls)row.append(node);
 header.prepend(row);

 function showDock(visible,persist=true){
  const focused=document.activeElement===toggle;
  dockVisible=visible;controls.hidden=!visible;toggle.setAttribute('aria-expanded',String(visible));bind(toggle,visible?'frame.hideSizes':'frame.showSizes',{},'title');bind(toggle,visible?'frame.hideSizes':'frame.showSizes',{},'aria-label');bind(toggle,visible?'frame.sizesOpen':'frame.sizesClosed');
  // The native trigger stays in the first header row; the panel owns its own row.
  if(focused)toggle.focus({preventScroll:true});
  if(persist)try{localStorage.setItem(visibilityKey,visible?'visible':'hidden')}catch{}
  schedule();
 }
 toggle.onclick=()=>showDock(!dockVisible);showDock(dockVisible,false);
 new ResizeObserver(schedule).observe(controls);
 const $=s=>controls.querySelector(s);
 // Initialization/validation errors remain visible even outside custom mode.
 controls.append($('#preview-error'));
 // Zoom changes paint only; the output always reports the real layout viewport.
 bind($('#preview-zoom'),'frame.zoomHint',{},'title');
 for(const zoom of ['50','75'])$('#preview-zoom').add(new Option(zoom+'%',zoom),$('#preview-zoom').querySelector('[value="actual"]'));
 for(const zoom of ['125','150','200'])$('#preview-zoom').add(new Option(zoom+'%',zoom));
 const handle=document.createElement('button');handle.type='button';handle.id='preview-resize';handle.textContent='↘';bind(handle,'frame.resizeHint',{},'title');bind(handle,'frame.resizeHint',{},'aria-label');
 let drag=null;
 function finishDrag(){
  if(!drag)return;const id=drag.id;drag=null;document.body.classList.remove('preview-resizing');
  if(handle.hasPointerCapture(id))handle.releasePointerCapture(id);
  save();paint();schedule();
 }
 function customSize(width,height){p.mode='custom';p.rotated=false;p.custom={width:Math.max(MIN_SIZE,Math.min(MAX_SIZE,Math.round(width))),height:Math.max(MIN_SIZE,Math.min(MAX_SIZE,Math.round(height)))};paint();measure()}
 handle.addEventListener('pointerdown',e=>{
  if(e.button!==0||!currentFrame)return;e.preventDefault();measure();
  drag={id:e.pointerId,x:e.clientX,y:e.clientY,width:Number(root.dataset.previewWidth),height:Number(root.dataset.previewHeight),scale:Number(currentFrame.dataset.previewScale)};
  handle.setPointerCapture(e.pointerId);document.body.classList.add('preview-resizing');
 });
 handle.addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.id)return;e.preventDefault();
  const box=article.getBoundingClientRect();
  // Capture crosses the iframe; a bounded stage clips the handle, never the rails.
  const x=Math.max(box.left+12,Math.min(box.right-12,e.clientX)),y=Math.max(box.top+12,Math.min(box.bottom-12,e.clientY));
  const maxW=p.zoom==='fit'?Math.max(MIN_SIZE,(box.width-24)/drag.scale):MAX_SIZE,maxH=p.zoom==='fit'?Math.max(MIN_SIZE,(box.height-24)/drag.scale):MAX_SIZE;
  customSize(Math.min(maxW,drag.width+(x-drag.x)/drag.scale),Math.min(maxH,drag.height+(y-drag.y)/drag.scale));
 });
 for(const event of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(event,finishDrag);
 window.addEventListener('blur',finishDrag);
 handle.addEventListener('keydown',e=>{
  if(e.key==='Enter'||e.key===' '){e.preventDefault();customSize(Number(root.dataset.previewWidth),Number(root.dataset.previewHeight));save();showDock(true);$('#preview-width').focus();return}
  const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
  if(delta){e.preventDefault();const step=e.shiftKey?50:10;customSize(Number(root.dataset.previewWidth)+delta[0]*step,Number(root.dataset.previewHeight)+delta[1]*step);save()}
 });
 function paint(){
  $('#preview-mode').value=p.mode;$('#preview-zoom').value=p.zoom;$('#preview-rotate').disabled=['article','auto'].includes(p.mode);$('#preview-rotate').setAttribute('aria-pressed',String(p.rotated));$('#preview-zoom').disabled=p.mode==='article';$('#preview-custom').hidden=p.mode!=='custom';
  if(document.activeElement!==$('#preview-width'))$('#preview-width').value=p.custom.width;
  if(document.activeElement!==$('#preview-height'))$('#preview-height').value=p.custom.height;
 }
 function save(){try{localStorage.setItem(key,JSON.stringify(p))}catch{ /* private/quota storage: preview still works */ }}
 function measure(){
  raf=0;if(p.mode==='article'||!currentFrame||!article.getClientRects().length)return;
  const dock=document.querySelector('.dock'),dockHeight=getComputedStyle(dock).display==='none'?0:dock.getBoundingClientRect().height;
  const viewportBottom=Math.min(innerHeight,(window.visualViewport?.offsetTop||0)+(window.visualViewport?.height||innerHeight));
  const draftActions=document.querySelector('#draft-actions'),draftHeight=innerWidth<=600&&draftActions&&!draftActions.hidden?draftActions.getBoundingClientRect().height+8:0;
  const availableHeight=Math.max(80,viewportBottom-article.getBoundingClientRect().top-dockHeight-draftHeight-8);
  article.style.height=availableHeight+'px';
  const style=getComputedStyle(article),px=v=>parseFloat(v)||0;
  const availableWidth=Math.max(1,article.clientWidth-px(style.paddingLeft)-px(style.paddingRight)),spaceHeight=Math.max(1,article.clientHeight-px(style.paddingTop)-px(style.paddingBottom));
  const [width,height]=p.mode==='auto'?[Math.max(1,Math.floor(availableWidth)),Math.max(1,Math.floor(spaceHeight))]:dimensions(p);
  const scale=p.zoom==='fit'?Math.min(1,availableWidth/width,spaceHeight/height):p.zoom==='actual'?1:Number(p.zoom)/100;
  root.style.setProperty('--preview-width',width*scale+'px');root.style.setProperty('--preview-height',height*scale+'px');
  currentFrame.style.width=width+'px';currentFrame.style.height=height+'px';currentFrame.style.transform=`scale(${scale})`;
  currentFrame.dataset.previewScale=String(scale);root.dataset.previewWidth=String(width);root.dataset.previewHeight=String(height);
  if(!handle.isConnected)root.append(handle);
  $('#preview-percent').value=`${width}×${height} · ${Math.round(scale*100)}%`;$('#preview-percent').textContent=$('#preview-percent').value;
  bind($('#preview-percent'),'frame.geometry',{width,height,zoom:Math.round(scale*100)},'title');bind($('#preview-percent'),'frame.geometry',{width,height,zoom:Math.round(scale*100)},'aria-label');
  document.dispatchEvent(new Event('preview-geometry'));
 }
 function schedule(){if(!raf)raf=requestAnimationFrame(measure)}
 async function update(){
  paint();save();if(changing){again=true;return}changing=true;
  try{
   const device=p.mode!=='article';
   if(staticPreview)await staticPreview.setActive(device);
   currentFrame=staticPreview?.frame||bridge.state.frame;
   document.body.classList.toggle('preview-device',device);
   if(currentFrame){
    currentFrame.classList.toggle('preview-content',device);
    if(!device){currentFrame.style.removeProperty('transform');currentFrame.style.removeProperty('width');currentFrame.style.removeProperty('height');if(!staticPreview){currentFrame.style.width='100%';currentFrame.style.height='calc(100vh - var(--hs-bar-h))'}}
   }
   if(!device){article.style.removeProperty('height');root.style.removeProperty('--preview-width');root.style.removeProperty('--preview-height');$('#preview-percent').textContent='—'}
   else{article.scrollTo(0,0);measure()}
   document.dispatchEvent(new CustomEvent('preview-change',{detail:{device}}));
  }catch(e){unbind($('#preview-error'));$('#preview-error').textContent=e.message;showDock(true,false);paint()}
  finally{changing=false;if(again){again=false;await update()}}
 }
 $('#preview-mode').onchange=e=>{p.mode=e.target.value;p.rotated=false;unbind($('#preview-error'));$('#preview-error').textContent='';update()};
 $('#preview-zoom').onchange=e=>{p.zoom=e.target.value;save();measure()};
 $('#preview-rotate').onclick=()=>{p.rotated=!p.rotated;save();paint();measure()};
 // Validate explicitly even where browser number widgets reject invalid text.
 $('#preview-custom').noValidate=true;
 $('#preview-custom').onsubmit=e=>{e.preventDefault();const w=Number($('#preview-width').value),h=Number($('#preview-height').value);if(!validSize(w)||!validSize(h)){bind($('#preview-error'),'frame.sizeError');return}p.custom={width:w,height:h};p.rotated=false;unbind($('#preview-error'));$('#preview-error').textContent='';save();paint();measure()};
 new ResizeObserver(schedule).observe(article);new ResizeObserver(schedule).observe(header);
 new ResizeObserver(schedule).observe(document.querySelector('.dock'));
 const draftActions=document.querySelector('#draft-actions');if(draftActions){new ResizeObserver(schedule).observe(draftActions);new MutationObserver(schedule).observe(draftActions,{attributes:true,attributeFilter:['hidden']})}
 window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
 window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,{passive:true});
 new MutationObserver(()=>{const f=staticPreview?.frame||bridge.state.frame;if(f!==currentFrame)update();else schedule()}).observe(root,{childList:true});
 document.addEventListener('preview-change',schedule);
 article.addEventListener('scroll',()=>document.dispatchEvent(new Event('preview-geometry')),{passive:true});
 document.addEventListener('preview-reveal',e=>{
  if(p.mode==='article'||e.detail?.frame!==currentFrame)return;
  const r=e.detail.rect,box=currentFrame.getBoundingClientRect(),view=article.getBoundingClientRect(),sx=box.width/currentFrame.offsetWidth,sy=box.height/currentFrame.offsetHeight;
  const x=box.left+(r.left+r.width/2)*sx,y=box.top+(r.top+r.height/2)*sy;
  article.scrollLeft+=x-view.left-view.width/2;article.scrollTop+=y-view.top-view.height/2;
 });
 update();
 return {get state(){return {...p,dimensions:p.mode==='auto'?[Number(root.dataset.previewWidth),Number(root.dataset.previewHeight)]:dimensions(p)}},measure};
}
