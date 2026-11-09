// Shared controller: also inlined into opaque-origin frames (no imports there).
export function elementReview({root,hash,enabled,onPick,onText=()=>{},onCancel=()=>{}}){
 const doc=root.ownerDocument,win=doc.defaultView,bindings=new Map();let chosen=null,hover=null,press=null,timer=0,epoch=0,revealing=false;
 const ignored='script,style,head,meta,link,title,template,[data-review-overlay],[data-review-point],[data-review-del],[data-review-ins],.marker';
 const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
 function target(node){let el=node?.nodeType===1?node:node?.parentElement;if(!el||!root.contains(el)||el===root||el.localName==='body'||el.localName==='html'||el.closest(ignored))return null;el=el.closest('svg')||el;if(el.hasAttribute('data-hs-straytext'))el=el.parentElement;return el===root?null:el}
 function identity(el){for(const key of ['id','data-testid','data-key','data-id']){const v=el.getAttribute(key);if(v&&v.length<=160)return [key,v]}return null}
 function fingerprint(el){const clone=el.cloneNode(true);clone.querySelectorAll('[data-review-point],[data-review-ins],[data-review-overlay]').forEach(n=>n.remove());return [el.localName,norm(el.getAttribute('class')).split(' ').filter(s=>!/^hs-|^record-focus$/.test(s)).sort().join(' '),el.getAttribute('src')||'',el.getAttribute('alt')||'',norm(clone.textContent).slice(0,160)]}
 function signature(el){const own=identity(el);if(own)return JSON.stringify([el.localName,own]);let scope=[];for(let p=el.parentElement;p&&p!==root;p=p.parentElement){const id=identity(p);if(id){scope=[p.localName,id];break}}return JSON.stringify([scope,fingerprint(el)])}
 const nodes=()=>[...root.querySelectorAll('*')].filter(n=>target(n)===n);
 async function anchor(el){const sig=signature(el),a='c2:'+await hash(sig),unique=nodes().filter(n=>signature(n)===sig).length===1;if(!unique)bindings.set(a,null);else if(!bindings.has(a))bindings.set(a,el);else if(bindings.get(a)!==el)bindings.set(a,null);return a}
 async function resolve(a){if(bindings.has(a)){const el=bindings.get(a);return el?.isConnected&&root.contains(el)?el:null}const matches=[];for(const el of nodes())if('c2:'+await hash(signature(el))===a)matches.push(el);const result=matches.length===1?matches[0]:null;bindings.set(a,result);return result}
 function box(){const n=doc.createElement('div');n.dataset.reviewOverlay='';n.setAttribute('aria-hidden','true');n.style.cssText='position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #79609a;border-radius:3px;box-sizing:border-box;display:none';doc.documentElement.append(n);return n}
 let outline=null;
 function paint(){const el=chosen||hover;if(!outline&&el)outline=box();if(!outline)return;if(!el?.isConnected||(!enabled()&&!revealing)){outline.style.display='none';return}const r=el.getBoundingClientRect();Object.assign(outline.style,{display:'block',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',borderStyle:chosen?'solid':'dashed'})}
 function label(el){return el.localName+(el.id?' #'+el.id:'')+': '+norm(el.getAttribute('aria-label')||el.getAttribute('alt')||el.textContent).slice(0,55)}
 function children(el){return [...el.children].map(target).filter((n,i,a)=>n&&n!==el&&a.indexOf(n)===i)}
 async function pick(el){const ticket=++epoch;revealing=false;chosen=el;hover=null;paint();const a=await anchor(el);if(ticket!==epoch||!enabled()||chosen!==el)return;const r=el.getBoundingClientRect(),p=target(el.parentElement),kids=children(el);onPick({anchor:a,quote:label(el),snippet:label(el),isText:false,parent:!!p,child:!!kids.length,rect:{left:r.left,top:r.top,width:r.width,height:r.height}})}
 function clear(){revealing=false;epoch++;clearTimeout(timer);chosen=null;hover=null;press=null;paint();onCancel()}
 function stop(e,prevent=false){if(prevent)e.preventDefault();e.stopImmediatePropagation()}
 function selection(){const s=win.getSelection();return s&&!s.isCollapsed&&s.toString().trim()&&root.contains(s.anchorNode)&&root.contains(s.focusNode)}
 // Window capture precedes document/page handlers, including handlers registered
 // before DOMContentLoaded. Do not cancel down defaults: native range/touch scroll.
 for(const type of ['pointerdown','mousedown','touchstart'])win.addEventListener(type,e=>{if(!enabled()||!target(e.target))return;if(type==='pointerdown'){clearTimeout(timer);epoch++;press={x:e.clientX,y:e.clientY,el:target(e.target)}}stop(e,type!=='touchstart'&&!!e.target.closest?.('input,textarea,select'))},true);
 for(const type of ['pointerup','mouseup','touchend'])win.addEventListener(type,e=>{if(!enabled()||!target(e.target))return;stop(e);if(type!=='pointerup')return;const p=press;press=null;clearTimeout(timer);timer=win.setTimeout(()=>{if(!enabled())return;if(selection()&&(!p||win.getSelection().getRangeAt(0).intersectsNode(p.el))){chosen=null;paint();onText();return}if(p&&Math.hypot(e.clientX-p.x,e.clientY-p.y)<8){win.getSelection()?.removeAllRanges();pick(p.el)}},320)},true);
 for(const type of ['click','dblclick','auxclick','submit'])win.addEventListener(type,e=>{if(enabled()&&target(e.target))stop(e,true)},true);
 win.addEventListener('pointermove',e=>{if(!enabled()||!target(e.target))return;stop(e);if(press)return;hover=target(e.target);paint()},true);
 win.addEventListener('pointercancel',()=>{press=null;clearTimeout(timer)},true);
 win.addEventListener('keydown',e=>{if(!enabled()||e.target?.nodeType!==1||!root.contains(e.target))return;if(e.key==='Escape'){stop(e,true);clear();return}if(e.key!=='Tab'&&e.target.closest?.('input,textarea,select')){stop(e,true);if(['Enter',' '].includes(e.key))pick(target(e.target));return}if(['Enter',' '].includes(e.key)&&target(e.target)){stop(e,true);pick(target(e.target));return}if(target(e.target))stop(e)},true);
 win.addEventListener('keyup',e=>{if(!enabled()||!target(e.target)||e.key==='Tab')return;stop(e);if(selection())onText()},true);
 win.addEventListener('keypress',e=>{if(enabled()&&target(e.target))stop(e,true)},true);
 doc.addEventListener('selectionchange',()=>{if(enabled()&&selection()){chosen=null;hover=null;paint()}});
 win.addEventListener('scroll',paint,true);win.addEventListener('resize',paint);
 return {resolve,anchor,clear,refresh:paint,async navigate(direction){if(!chosen?.isConnected)return;const next=direction==='parent'?target(chosen.parentElement):children(chosen)[0];if(next)await pick(next)},async reveal(a){const el=await resolve(a);if(el){revealing=true;chosen=el;paint();win.setTimeout(()=>{revealing=false;paint()},1800)}return el}};
}
