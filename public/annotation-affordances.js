// Review-only controls live outside source flow. No numeric text is inserted
// into a sentence; one count is computed from distinct comment IDs per block.
export function annotationAffordances({doc,onOpen}){
 const win=doc.defaultView,layer=doc.createElement('div');layer.dataset.reviewOverlay='';layer.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483645;overflow:hidden';doc.documentElement.append(layer);let groups=[],mobile=false;
 function paint(){layer.replaceChildren();if(mobile)return;for(const g of groups){const el=[...doc.querySelectorAll('[data-hs-anchor]')].find(n=>n.dataset.hsAnchor===g.anchor);if(!el||!g.ids.length)continue;const r=el.getBoundingClientRect();if(r.bottom<0||r.top>win.innerHeight)continue;const size=30,x=r.right+size+4<=win.innerWidth?r.right+4:r.left>=size+4?r.left-size-4:null;if(x===null)continue;const b=doc.createElement('button');b.type='button';b.dataset.reviewOverlay='';b.dataset.commentCount=String(g.ids.length);b.textContent='◯ '+g.ids.length;b.setAttribute('aria-label',`打开此段 ${g.ids.length} 条批注`);b.style.cssText=`position:absolute;pointer-events:auto;box-sizing:border-box;left:${x}px;top:${Math.max(0,r.top)}px;width:${size}px;min-height:30px;padding:3px;border:1px solid #9dc1ab;border-radius:12px;background:#edf6ef;color:#285d48;font:12px/1.5 system-ui;cursor:pointer`;b.onclick=()=>onOpen(g.ids);layer.append(b)}}
 function open(e){const marked=e.target.closest?.('[data-thread]');if(!marked)return;const ids=[...new Set([marked,...Array.from(doc.elementsFromPoint?.(e.clientX||0,e.clientY||0)||[])].filter(n=>n.hasAttribute?.('data-thread')).map(n=>n.dataset.thread))];if(ids.length){e.preventDefault();e.stopPropagation();onOpen(ids)}}
 doc.addEventListener('click',open);
 doc.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.hasAttribute?.('data-thread')){e.preventDefault();const ids=[];for(let n=e.target;n;n=n.parentElement)if(n.dataset?.thread)ids.push(n.dataset.thread);onOpen([...new Set(ids)])}});
 win.addEventListener('scroll',paint,true);win.addEventListener('resize',paint);
 return {sync(value,phone){groups=value;mobile=phone;paint()},paint};
}
