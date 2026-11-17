// Reading coordinates only. Never persist source HTML, selections, forms or drafts.
const KEY='marginroom.reading.v1:';
const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=1e7&&Math.abs(p.y)<=1e7?{x:Math.max(0,p.x),y:Math.max(0,p.y)}:null;
export function sanitizeReading(v){
 const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=1e7&&Math.abs(p.y)<=1e7?{x:Math.max(0,p.x),y:Math.max(0,p.y)}:null;
 if(!v||typeof v!=='object')return null;
 const p=point(v);if(!p)return null;
 const anchor=a=>typeof a==='string'&&a.length>0&&a.length<=256&&!/[\u0000-\u001f]/.test(a);
 if(anchor(v.anchor)&&Number.isFinite(v.offset)&&Math.abs(v.offset)<=1e7){p.anchor=v.anchor;p.offset=v.offset}
 p.containers=Array.isArray(v.containers)?v.containers.slice(0,8).flatMap(c=>{const xy=point(c);return xy&&anchor(c.anchor)&&Number.isInteger(c.up)&&c.up>=0&&c.up<=16?[{...xy,anchor:c.anchor,up:c.up}]:[]}):[];
 return p;
}
// Self-contained so the exact trusted implementation can run in the static sandbox.
export function readingPosition(action,value,doc=document,root=doc.body){
 const win=doc.defaultView,scroll=doc.scrollingElement;
 const blocks=[...root.querySelectorAll('[data-hs-anchor]')];
 const find=a=>blocks.find(n=>n.dataset.hsAnchor===a);
 const clamp=(n,max)=>Math.max(0,Math.min(Math.max(0,max),Number.isFinite(n)?n:0));
 const move=(el,p)=>{el.scrollLeft=clamp(p.x,el.scrollWidth-el.clientWidth);el.scrollTop=clamp(p.y,el.scrollHeight-el.clientHeight)};
 if(action==='restore'){
  if(!value||!scroll)return;
  move(scroll,value);
  for(const c of value.containers||[]){let el=find(c.anchor);for(let i=0;el&&i<c.up;i++)el=el.parentElement;if(el&&root.contains(el))move(el,c)}
  const el=find(value.anchor);if(el&&Number.isFinite(value.offset)){const delta=el.getBoundingClientRect().top-value.offset;let owner=el.parentElement;while(owner&&owner!==scroll){const css=win.getComputedStyle(owner);if(owner.scrollHeight>owner.clientHeight+1&&/auto|scroll/.test(css.overflowY))break;owner=owner.parentElement}owner=owner||scroll;owner.scrollTop=clamp(owner.scrollTop+delta,owner.scrollHeight-owner.clientHeight)}
  return;
 }
 const p={x:scroll?.scrollLeft||0,y:scroll?.scrollTop||0,containers:[]},seen=new Set();
 for(const block of blocks){let el=block;for(let up=0;el&&up<=16&&root.contains(el);up++,el=el.parentElement){if(el===scroll||seen.has(el))continue;seen.add(el);if(el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1){const css=win.getComputedStyle(el);if(/auto|scroll/.test(css.overflowY+css.overflowX)&&p.containers.length<8)p.containers.push({anchor:block.dataset.hsAnchor,up,x:el.scrollLeft,y:el.scrollTop})}}}
 const visible=blocks.map(el=>({el,r:el.getBoundingClientRect()})).filter(({r})=>r.bottom>0&&r.top<win.innerHeight&&r.height>0).sort((a,b)=>Math.abs(a.r.top)-Math.abs(b.r.top))[0];
 if(visible){p.anchor=visible.el.dataset.hsAnchor;p.offset=visible.r.top}
 return p;
}
export function initReading({docId,root,article,main,staticPreview,interactive=false,frame=null,storage,win=window}){
 try{storage??=win.localStorage}catch{}
 const key=KEY+docId;let saved=null,content=null,ready=false,timer=0,restored=false;
 try{const v=JSON.parse(storage?.getItem(key));if(v?.v===1&&v.id===docId&&point(v.article)&&point(v.main)&&point(v.window))saved={v:1,id:docId,article:point(v.article),main:point(v.main),window:point(v.window),content:interactive?point(v.content):sanitizeReading(v.content)}}catch{}
 const xy=el=>({x:el?.scrollLeft||0,y:el?.scrollTop||0});
 function persist(){if(!ready)return;try{storage?.setItem(key,JSON.stringify({v:1,id:docId,article:xy(article),main:xy(main),window:{x:win.scrollX,y:win.scrollY},content:interactive?point(content):staticPreview?.active?content:readingPosition('capture',null,root.ownerDocument,root)}))}catch{}}
 function schedule(){if(ready){clearTimeout(timer);timer=win.setTimeout(persist,180)}}
 function restore(){if(restored)return;restored=true;
  if(saved){const move=(el,p)=>{if(el)el.scrollTo(Math.min(p.x,Math.max(0,el.scrollWidth-el.clientWidth)),Math.min(p.y,Math.max(0,el.scrollHeight-el.clientHeight)))};
   move(article,saved.article);move(main,saved.main);win.scrollTo(saved.window.x,saved.window.y);
   if(!interactive&&saved.content){if(staticPreview?.active)staticPreview.send({type:'reading-restore',position:saved.content});else readingPosition('restore',saved.content,root.ownerDocument,root)}
   content=saved.content;
  }
  ready=true;
  // bridge.init awaited the existing controller readiness; preview-change has
  // now applied final viewport geometry. Never read the opaque frame's DOM.
  if(interactive)frame?.contentWindow?.postMessage(saved?.content?{type:'entry-reading-restore',position:point(saved.content)}:{type:'entry-reading-capture'},'*');
 }
 // preview-change follows controller readiness + final viewport sizing, not iframe load.
 const onReady=()=>win.requestAnimationFrame(()=>win.requestAnimationFrame(restore));
 root.ownerDocument.addEventListener('preview-change',onReady);
 // Source scripts share this channel: identity is not authority for any field.
 // This listener can only update bounded numeric reading coordinates, not APIs.
 if(interactive)win.addEventListener('message',e=>{if(!ready||!frame?.contentWindow||e.source!==frame.contentWindow||e.data?.type!=='entry-reading-position')return;const p=point(e.data.position);if(p){content=p;schedule()}});
 root.ownerDocument.addEventListener('scroll',e=>{if(e.target===root.ownerDocument||e.target===article||e.target===main||root.contains(e.target))schedule()}, {passive:true,capture:true});
 win.addEventListener('scroll',schedule,{passive:true});article?.addEventListener('scroll',schedule,{passive:true});main?.addEventListener('scroll',schedule,{passive:true});
 win.addEventListener('pagehide',persist);root.ownerDocument.addEventListener('visibilitychange',()=>{if(root.ownerDocument.hidden)persist()});
 return {onMessage(m){if(m.type!=='reading-position')return;const p=sanitizeReading(m.position);if(p){content=p;schedule()}},persist,ready:onReady};
}
