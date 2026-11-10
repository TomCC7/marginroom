// Review-only controls live outside source flow. Status transitions never
// replace source HTML, form nodes, frames or a live inline editor.
export function annotationAffordances({doc,onOpen,resolveTarget}){
 const win=doc.defaultView,layer=doc.createElement('div');layer.dataset.reviewOverlay='';layer.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483645;overflow:hidden';doc.documentElement.append(layer);let groups=[],mobile=false,epoch=0;
 const find=a=>[...doc.querySelectorAll('[data-hs-anchor],[data-hs-comment-anchor]')].find(n=>(n.dataset.hsAnchor||n.dataset.hsCommentAnchor)===a);
 async function paint(){const ticket=++epoch;const targets=await Promise.all(groups.map(async g=>({...g,el:find(g.anchor)||await resolveTarget?.(g.anchor)})));if(ticket!==epoch)return;layer.replaceChildren();for(const g of targets){const el=g.el;if(!el?.isConnected||!g.ids.length)continue;const r=el.getBoundingClientRect();if(r.bottom<0||r.top>win.innerHeight)continue;
  if(g.anchor.startsWith('c')){const outline=doc.createElement('div');outline.dataset.reviewOverlay='';outline.style.cssText=`position:absolute;pointer-events:none;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;outline:1px solid #71a087`;layer.append(outline)}
  if(mobile)continue;const size=30,x=r.right+size+4<=win.innerWidth?r.right+4:r.left>=size+4?r.left-size-4:null;if(x===null)continue;const b=doc.createElement('button');b.type='button';b.dataset.reviewOverlay='';b.dataset.commentCount=String(g.ids.length);b.dataset.commentAnchor=g.anchor;b.textContent='◯ '+g.ids.length;b.setAttribute('aria-label',`打开此段 ${g.ids.length} 条批注`);b.style.cssText=`position:absolute;pointer-events:auto;box-sizing:border-box;left:${x}px;top:${Math.max(0,r.top)}px;width:${size}px;min-height:30px;padding:3px;border:1px solid #9dc1ab;border-radius:12px;background:#edf6ef;color:#285d48;font:12px/1.5 system-ui;cursor:pointer`;b.onclick=()=>onOpen(g.ids);layer.append(b)}}
 function comments(items,skipAnchor){
  // Keep dormant wrappers as inert spans: resolving changes attributes only,
  // preserving native text nodes/ranges, nested controls and source handlers.
  for(const s of items){let spans=[...doc.querySelectorAll('[data-review-mark],[data-review-comment]')].filter(n=>(n.dataset.reviewComment||n.dataset.thread)===s.id);
   const el=find(s.anchor);if(s.anchor===skipAnchor||el?.querySelector('[data-inline-editor]'))continue;
   if(s.open&&!s.stale&&!s.fallback&&el&&!spans.length&&Number.isInteger(s.start)&&Number.isInteger(s.end)){
    const walker=doc.createTreeWalker(el,4);let n,pos=0,start,end,so,eo;while(n=walker.nextNode()){if(n.parentElement.closest('[data-review-ins],[data-review-point],[data-inline-old]'))continue;if(!start&&pos+n.length>=s.start){start=n;so=s.start-pos}if(pos+n.length>=s.end){end=n;eo=s.end-pos;break}pos+=n.length}
    if(start&&end){
     const selection=win.getSelection(),saved=selection?.rangeCount?[selection.anchorNode,selection.anchorOffset,selection.focusNode,selection.focusOffset]:null;
     const logical=(node,offset)=>{if(!el.contains(node))return {node,offset};const r=doc.createRange();r.selectNodeContents(el);r.setEnd(node,offset);const copy=r.cloneContents();copy.querySelectorAll?.('[data-review-ins],[data-review-point]').forEach(n=>n.remove());return {offset:copy.textContent.length}};
     const positions=saved?[logical(saved[0],saved[1]),logical(saved[2],saved[3])]:null;
     const r=doc.createRange();r.setStart(start,so);r.setEnd(end,eo);const span=doc.createElement('span');if(s.start!==s.end)span.append(r.extractContents());else span.dataset.reviewPoint='';r.insertNode(span);spans=[span];
     if(positions&&(el.contains(saved[0])||el.contains(saved[2]))){const point=p=>{if(p.node)return p;const w=doc.createTreeWalker(el,4);let n,pos=0;while(n=w.nextNode()){if(n.parentElement.closest('[data-review-ins],[data-review-point]'))continue;if(pos+n.length>=p.offset)return {node:n,offset:p.offset-pos};pos+=n.length}return {node:el,offset:el.childNodes.length}};const a=point(positions[0]),b=point(positions[1]);selection.setBaseAndExtent(a.node,a.offset,b.node,b.offset)}
    }
   }
   for(const n of spans){n.dataset.reviewComment=s.id;if(n.hasAttribute('data-review-point'))n.dataset.reviewCommentPoint='';if(s.open&&!s.stale){n.dataset.thread=s.id;n.dataset.reviewMark='';if(n.hasAttribute('data-review-comment-point'))n.dataset.reviewPoint='';n.tabIndex=0;n.setAttribute('role','button');n.setAttribute('aria-label','打开此处批注')}else{delete n.dataset.thread;delete n.dataset.reviewMark;delete n.dataset.reviewPoint;n.removeAttribute('tabindex');n.removeAttribute('role');n.removeAttribute('aria-label');n.classList.remove('done','record-focus')}}
   if(el){const open=items.filter(t=>t.anchor===s.anchor&&t.open&&!t.stale);if(!open.length){delete el.dataset.reviewBlockThread;el.classList.remove('record-focus')}else if(s.fallback)el.dataset.reviewBlockThread=open[0].id}
  }
 }
 function open(e){const marked=e.target.closest?.('[data-thread]');if(!marked)return;const ids=[...new Set([marked,...Array.from(doc.elementsFromPoint?.(e.clientX||0,e.clientY||0)||[])].filter(n=>n.hasAttribute?.('data-thread')).map(n=>n.dataset.thread))];if(ids.length){e.preventDefault();e.stopPropagation();onOpen(ids)}}
 doc.addEventListener('click',open);
 doc.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.hasAttribute?.('data-thread')){e.preventDefault();const ids=[];for(let n=e.target;n;n=n.parentElement)if(n.dataset?.thread)ids.push(n.dataset.thread);onOpen([...new Set(ids)])}});
 win.addEventListener('scroll',paint,true);win.addEventListener('resize',paint);
 return {comments,sync(value,phone){groups=value;mobile=phone;paint()},paint};
}
