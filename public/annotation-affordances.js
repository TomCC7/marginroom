import {logicalNodes,logicalOffset,logicalRange,logicalText,legacyMathLocation} from './logical-text.js';
// Review-only controls live outside source flow. Status transitions never
// replace source HTML, form nodes, frames or a live inline editor.
export function annotationAffordances({doc,onOpen,resolveTarget,translate=(...args)=>doc.defaultView.__marginroomLocale.t(...args)}){
 const win=doc.defaultView,layer=doc.createElement('div');layer.dataset.reviewOverlay='';layer.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483645;overflow:hidden';doc.documentElement.append(layer);let groups=[],mobile=false,epoch=0,active=null;
 const find=a=>[...doc.querySelectorAll('[data-hs-anchor],[data-hs-comment-anchor]')].find(n=>(n.dataset.hsAnchor||n.dataset.hsCommentAnchor)===a||n.dataset.hsLegacyAnchor===a);
 const style=doc.createElement('style');style.dataset.reviewOverlay='';style.textContent='[data-review-tag]:focus-visible{outline:3px solid #123e2c!important;outline-offset:2px}@media(forced-colors:active){[data-review-tag]{border:1px solid ButtonText!important}[data-review-tag]:focus-visible{outline:3px solid Highlight!important}}';layer.append(style);
 // Source-safe gutters only: never reserve width, clamp onto letters, or float
 // tags for a target clipped by a nested scroller. Inline marks + rail remain
 // available when the imported page has no safe margin (including full bleed).
 function visible(el,r){if(!r.width||!r.height||r.top<0||r.top+30>win.innerHeight||r.right<=0||r.left>=win.innerWidth)return false;for(let p=el.parentElement;p;p=p.parentElement){const css=win.getComputedStyle(p),b=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(css.overflowY)&& (r.top<b.top||r.top+30>b.bottom))return false;if(/auto|scroll|hidden|clip/.test(css.overflowX)&&(r.right<=b.left||r.left>=b.right))return false}return true}
 async function paint(){const ticket=++epoch;const targets=await Promise.all(groups.map(async g=>({...g,el:find(g.anchor)||await resolveTarget?.(g.anchor)})));if(ticket!==epoch)return;const focused=doc.activeElement?.dataset.reviewTag,placed=[];layer.replaceChildren(style);for(const g of targets){const el=g.el;if(!el?.isConnected||!g.ids.length)continue;const r=el.getBoundingClientRect();if(!visible(el,r))continue;
  if(g.anchor.startsWith('c')){const outline=doc.createElement('div');outline.dataset.reviewOverlay='';outline.style.cssText=`position:absolute;pointer-events:none;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;outline:1px solid #71a087`;layer.append(outline)}
  const rewrite=g.kind==='rewrite',w=mobile?24:(rewrite?(g.ids.length>1?72:58):36),h=30,gap=mobile?3:4;
  const safe=(x,y)=>{if(x<2||x+w>win.innerWidth-2||y<0||y+h>win.innerHeight||placed.some(b=>x<b.x+b.w+2&&x+w+2>b.x&&y<b.y+h+2&&y+h+2>b.y))return false;for(const px of [x+1,x+w/2,x+w-1])for(const py of [y+1,y+h/2,y+h-1]){const hit=doc.elementFromPoint(px,py);if(hit&&!hit.closest('[data-review-overlay]')&&(!hit.contains(el)||hit.matches('button,a,input,select,textarea,[contenteditable=true]')))return false}return true};
  let pos=null;for(const y of [r.top,r.top+34]){for(const x of [r.right+gap,r.left-w-gap])if(safe(x,y)){pos={x,y};break}if(pos)break}if(!pos)continue;placed.push({...pos,w});
  const b=doc.createElement('button');b.type='button';b.dataset.reviewOverlay='';b.dataset.reviewTag=g.anchor+':'+(g.kind||'comment');b.dataset.tagKind=rewrite?'rewrite':'comment';b.dataset[rewrite?'revisionCount':'commentCount']=String(g.ids.length);b.dataset[rewrite?'revisionAnchor':'commentAnchor']=g.anchor;
  b.dataset.localeCount=String(g.ids.length);b.title=translate(rewrite?'frame.pendingRevision':'frame.markerComment',{count:g.ids.length});b.setAttribute('aria-label',b.title);b.setAttribute('aria-pressed',String(g.ids.includes(active)));
  b.innerHTML=`<svg aria-hidden="true" style="width:13px;height:13px;flex-shrink:0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">${rewrite?'<path d="m15 4 5 5M4 15 15 4a3.5 3.5 0 0 1 5 5L9 20l-6 1z"/>':'<path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z"/>'}</svg>`;b.append(doc.createTextNode(rewrite?(mobile?(g.ids.length>1?' '+g.ids.length:''):' '+translate('frame.markerRevision')+(g.ids.length>1?' '+g.ids.length:'')):' '+g.ids.length));
  b.style.cssText=`position:absolute;display:flex;flex-direction:${mobile?'column':'row'};align-items:center;justify-content:center;gap:0;pointer-events:auto;box-sizing:border-box;left:${pos.x}px;top:${pos.y}px;width:${w}px;min-width:${w}px;max-width:${w}px;height:${h}px;min-height:${h}px;max-height:${h}px;padding:${mobile?1:3}px;border:1px solid #9dc1ab;border-radius:12px;background:#edf6ef;color:#285d48;font:12px/${mobile?'1':'1.5'} system-ui;white-space:nowrap;cursor:pointer;${g.ids.includes(active)?'box-shadow:0 0 0 2px #285d48;':''}`;b.onclick=e=>{e.stopPropagation();onOpen(g.ids)};layer.append(b);if(focused===b.dataset.reviewTag)b.focus({preventScroll:true})}}
 function focus(id){active=id;paint()}
 let commentsEpoch=0;
 async function comments(items,skipAnchor){
  const ticket=++commentsEpoch,targets=new Map();
  for(const s of items)if(/^c[23]:/.test(s.anchor)){const el=await resolveTarget?.(s.anchor);if(el)targets.set(s.anchor,el);}
  if(ticket!==commentsEpoch)return;
  // Keep dormant wrappers as inert spans: resolving changes attributes only,
  // preserving native text nodes/ranges, nested controls and source handlers.
  for(let s of items){let spans=[...doc.querySelectorAll('[data-review-mark],[data-review-comment]')].filter(n=>(n.dataset.reviewComment||n.dataset.thread)===s.id);
   const el=find(s.anchor)||targets.get(s.anchor);if(s.anchor===skipAnchor||el?.querySelector('[data-inline-editor]'))continue;
   if(el&&targets.has(s.anchor)&&s.baseText&&Number.isInteger(s.rangeStart)&&Number.isInteger(s.rangeEnd)){
    const text=logicalText(el,'[data-review-ins],[data-review-point]');
    const loc=text===s.baseText&&text.slice(s.rangeStart,s.rangeEnd)===s.quote?{start:s.rangeStart,end:s.rangeEnd}:legacyMathLocation(el,s.baseText,s.quote,s.rangeStart,s.rangeEnd);
    if(loc){s={...s,...loc,fallback:false,stale:false};}else{s={...s,stale:true};}
   }
   if(s.open&&!s.stale&&!s.fallback&&el&&!spans.length&&Number.isInteger(s.start)&&Number.isInteger(s.end)){
    let pos=0,start,end,so,eo;for(const n of logicalNodes(el,'[data-review-ins],[data-review-point],[data-inline-old]')){if(!start&&pos+n.length>=s.start){start=n;so=s.start-pos}if(pos+n.length>=s.end){end=n;eo=s.end-pos;break}pos+=n.length}
    if(start&&end){
     const selection=win.getSelection(),saved=selection?.rangeCount?[selection.anchorNode,selection.anchorOffset,selection.focusNode,selection.focusOffset]:null;
     const logical=(node,offset)=>!el.contains(node)?{node,offset}:{offset:logicalOffset(el,node,offset,'[data-review-ins],[data-review-point]')};
     const positions=saved?[logical(saved[0],saved[1]),logical(saved[2],saved[3])]:null;
     const r=doc.createRange();r.setStart(start,so);r.setEnd(end,eo);const span=doc.createElement('span');if(s.start!==s.end)span.append(r.extractContents());else span.dataset.reviewPoint='';r.insertNode(span);spans=[span];
     if(positions&&(el.contains(saved[0])||el.contains(saved[2]))){const point=p=>{if(p.node)return p;const r=logicalRange(el,p.offset,p.offset,'[data-review-ins],[data-review-point]');return r?{node:r.startContainer,offset:r.startOffset}:{node:el,offset:el.childNodes.length}};const a=point(positions[0]),b=point(positions[1]);selection.setBaseAndExtent(a.node,a.offset,b.node,b.offset)}
    }
   }
   for(const n of spans){n.dataset.reviewComment=s.id;if(n.hasAttribute('data-review-point'))n.dataset.reviewCommentPoint='';if(s.open&&!s.stale){n.dataset.thread=s.id;n.dataset.reviewMark='';if(n.hasAttribute('data-review-comment-point'))n.dataset.reviewPoint='';n.tabIndex=0;n.setAttribute('role','button');n.setAttribute('aria-label',translate('review.openMark'))}else{delete n.dataset.thread;delete n.dataset.reviewMark;delete n.dataset.reviewPoint;n.removeAttribute('tabindex');n.removeAttribute('role');n.removeAttribute('aria-label');n.classList.remove('done','record-focus')}}
   if(el){const open=items.filter(t=>t.anchor===s.anchor&&t.open&&!t.stale);if(!open.length){delete el.dataset.reviewBlockThread;el.classList.remove('record-focus')}else if(s.fallback)el.dataset.reviewBlockThread=open[0].id}
  }
 }
 function open(e){const marked=e.target.closest?.('[data-thread]');if(!marked)return;const ids=[...new Set([marked,...Array.from(doc.elementsFromPoint?.(e.clientX||0,e.clientY||0)||[])].filter(n=>n.hasAttribute?.('data-thread')).map(n=>n.dataset.thread))];if(ids.length){e.preventDefault();e.stopPropagation();onOpen(ids)}}
 doc.addEventListener('click',open);
 doc.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.hasAttribute?.('data-thread')){e.preventDefault();const ids=[];for(let n=e.target;n;n=n.parentElement)if(n.dataset?.thread)ids.push(n.dataset.thread);onOpen([...new Set(ids)])}});
 let queued=false;function schedule(){if(queued)return;queued=true;win.requestAnimationFrame(()=>{queued=false;paint()})}
 win.addEventListener('scroll',schedule,true);win.addEventListener('resize',schedule);
 const observer=new win.MutationObserver(changes=>{if(changes.some(m=>!m.target.parentElement?.closest('[data-review-overlay]')&&!m.target.closest?.('[data-review-overlay]')))schedule()});observer.observe(doc.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','class','hidden']});
 if(win.ResizeObserver)new win.ResizeObserver(schedule).observe(doc.documentElement);
 function retireRewrites(ids,skipAnchor){
  for(const n of doc.querySelectorAll('[data-review-del][data-thread],[data-review-ins][data-thread]')){
   if(!ids.includes(n.dataset.thread)||n.closest('[data-inline-editor]')||n.closest('[data-hs-anchor]')?.dataset.hsAnchor===skipAnchor)continue;
   if(n.hasAttribute('data-review-ins')){n.remove();continue}
   delete n.dataset.reviewDel;delete n.dataset.reviewPoint;delete n.dataset.thread;
   n.style.textDecoration='none';n.style.background='none';n.style.color='inherit';n.removeAttribute('contenteditable');n.classList.remove('record-focus');
  }
 }
 function locale(){for(const b of layer.querySelectorAll('[data-review-tag]')){const rewrite=b.dataset.tagKind==='rewrite',count=Number(b.dataset.localeCount);b.title=translate(rewrite?'frame.pendingRevision':'frame.markerComment',{count});b.setAttribute('aria-label',b.title);const last=b.lastChild;if(last?.nodeType===3)last.data=rewrite?(mobile?(count>1?' '+count:''):' '+translate('frame.markerRevision')+(count>1?' '+count:'')):' '+count}for(const n of doc.querySelectorAll('[data-review-mark][role="button"]'))n.setAttribute('aria-label',translate('review.openMark'))}
 return {locale,comments,retireRewrites,focus,sync(value,phone){groups=value;mobile=phone;paint()},paint};
}
