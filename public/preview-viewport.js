// A real iframe viewport is sized first; only its painted content is scaled.
export const PRESETS = Object.freeze({desktop:[1440,900],laptop:[1366,768],tablet:[768,1024],phone:[390,844]});
export const MIN_SIZE=240, MAX_SIZE=4096;
export function validSize(n){return Number.isInteger(n)&&n>=MIN_SIZE&&n<=MAX_SIZE}
export function preferences(value){
 const v=value&&typeof value==='object'?value:{};
 return {mode:['article',...Object.keys(PRESETS),'custom'].includes(v.mode)?v.mode:'article',rotated:v.rotated===true,custom:{width:validSize(v.custom?.width)?v.custom.width:1280,height:validSize(v.custom?.height)?v.custom.height:800},zoom:v.zoom==='actual'?'actual':'fit'};
}
export function dimensions(p){const [w,h]=PRESETS[p.mode]||[p.custom.width,p.custom.height];return p.rotated?[h,w]:[w,h]}
export function initPreview({docId,bridge,staticPreview}){
 const article=document.querySelector('#article'),root=document.querySelector('#hs-doc-root'),header=document.querySelector('.topbar');
 const key='marginroom.preview.v1:'+docId;
 let p;try{p=preferences(JSON.parse(localStorage.getItem(key)))}catch{p=preferences()}
 let currentFrame=null,changing=false,again=false,raf=0;
 const controls=document.createElement('div');controls.className='preview-controls';controls.setAttribute('aria-label','预览视口');
 controls.innerHTML='<label class="sr-only" for="preview-mode">预览视口</label><select id="preview-mode"><option value="article">文章 · 原视图</option><option value="desktop">Desktop · 1440 × 900</option><option value="laptop">Laptop · 1366 × 768</option><option value="tablet">Tablet · 768 × 1024</option><option value="phone">Phone · 390 × 844</option><option value="custom">自定义尺寸</option></select><button id="preview-rotate" title="旋转视口" aria-label="旋转视口" type="button">↔</button><label class="sr-only" for="preview-zoom">预览缩放</label><select id="preview-zoom"><option value="fit">适应窗口</option><option value="actual">100%</option></select><output id="preview-percent" aria-live="polite"></output><form id="preview-custom" hidden><label>宽 <input id="preview-width" type="number" min="240" max="4096" step="1" required></label><span>×</span><label>高 <input id="preview-height" type="number" min="240" max="4096" step="1" required></label><button type="submit">应用</button><span id="preview-error" role="alert"></span></form>';
 header.append(controls);
 const $=s=>controls.querySelector(s);
 function paint(){
  $('#preview-mode').value=p.mode;$('#preview-zoom').value=p.zoom;$('#preview-rotate').disabled=p.mode==='article';$('#preview-rotate').setAttribute('aria-pressed',String(p.rotated));$('#preview-zoom').disabled=p.mode==='article';$('#preview-custom').hidden=p.mode!=='custom';
  if(document.activeElement!==$('#preview-width'))$('#preview-width').value=p.custom.width;
  if(document.activeElement!==$('#preview-height'))$('#preview-height').value=p.custom.height;
 }
 function save(){try{localStorage.setItem(key,JSON.stringify(p))}catch{ /* private/quota storage: preview still works */ }}
 function measure(){
  raf=0;if(p.mode==='article'||!currentFrame)return;
  const [width,height]=dimensions(p),dock=document.querySelector('.dock'),dockHeight=getComputedStyle(dock).display==='none'?0:dock.getBoundingClientRect().height;
  const availableHeight=Math.max(80,innerHeight-article.getBoundingClientRect().top-dockHeight-16);
  article.style.height=availableHeight+'px';
  const availableWidth=Math.max(1,article.clientWidth-16),spaceHeight=Math.max(1,availableHeight-16);
  const scale=p.zoom==='actual'?1:Math.min(1,availableWidth/width,spaceHeight/height);
  root.style.setProperty('--preview-width',width*scale+'px');root.style.setProperty('--preview-height',height*scale+'px');
  currentFrame.style.width=width+'px';currentFrame.style.height=height+'px';currentFrame.style.transform=`scale(${scale})`;
  currentFrame.dataset.previewScale=String(scale);root.dataset.previewWidth=String(width);root.dataset.previewHeight=String(height);
  $('#preview-percent').value=Math.round(scale*100)+'%';$('#preview-percent').textContent=Math.round(scale*100)+'%';
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
  }catch(e){$('#preview-error').textContent=e.message;p.mode='article';document.body.classList.remove('preview-device');paint()}
  finally{changing=false;if(again){again=false;await update()}}
 }
 $('#preview-mode').onchange=e=>{p.mode=e.target.value;p.rotated=false;$('#preview-error').textContent='';update()};
 $('#preview-zoom').onchange=e=>{p.zoom=e.target.value;save();measure()};
 $('#preview-rotate').onclick=()=>{p.rotated=!p.rotated;save();paint();measure()};
 // Validate explicitly even where browser number widgets reject invalid text.
 $('#preview-custom').noValidate=true;
 $('#preview-custom').onsubmit=e=>{e.preventDefault();const w=Number($('#preview-width').value),h=Number($('#preview-height').value);if(!validSize(w)||!validSize(h)){$('#preview-error').textContent='宽和高须为 240–4096 的整数';return}p.custom={width:w,height:h};p.rotated=false;$('#preview-error').textContent='';save();paint();measure()};
 new ResizeObserver(schedule).observe(article);new ResizeObserver(schedule).observe(header);
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
 return {get state(){return {...p,dimensions:dimensions(p)}},measure};
}
