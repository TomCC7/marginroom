// Shared controller: also inlined into opaque-origin frames (no imports there).
export function elementReview({root,hash,enabled,onPick,onText=()=>{},onCancel=()=>{},onThread=()=>{}}){
 const doc=root.ownerDocument,win=doc.defaultView,bindings=new Map();let chosen=null,hover=null,press=null,timer=0,epoch=0,revealing=false,picked=null;
 const ignored='script,style,head,meta,link,title,template,[data-review-overlay],[data-review-point],[data-review-del],[data-review-ins],.marker';
 const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
 function target(node){let el=node?.nodeType===1?node:node?.parentElement;if(!el||!root.contains(el)||el===root||el.localName==='body'||el.localName==='html'||el.closest(ignored))return null;el=el.closest('svg')||el;while(el.matches('[data-hs-straytext],[data-review-mark],[data-review-comment]'))el=el.parentElement;return el===root?null:el}
 function identity(el){for(const key of ['id','data-testid','data-key','data-id']){const v=el.getAttribute(key);if(v&&v.length<=160)return [key,v]}return null}
 function fingerprint(el){const clone=el.cloneNode(true);clone.querySelectorAll('[data-review-point],[data-review-ins],[data-review-overlay]').forEach(n=>n.remove());return [el.localName,norm(el.getAttribute('class')).split(' ').filter(s=>!/^hs-|^record-focus$/.test(s)).sort().join(' '),el.getAttribute('src')||'',el.getAttribute('alt')||'',norm(clone.textContent).slice(0,160)]}
 function signature(el){const own=identity(el);if(own)return JSON.stringify([el.localName,own]);let scope=[];for(let p=el.parentElement;p&&p!==root;p=p.parentElement){const id=identity(p);if(id){scope=[p.localName,id];break}}return JSON.stringify([scope,fingerprint(el)])}
 const nodes=()=>[...root.querySelectorAll('*')].filter(n=>target(n)===n);
 // c3 binds a logical path to the COMPLETE canonical scope, not an ordinal
 // alone. An insertion/deletion/change invalidates that scope on reload. A
 // unique source identity is its own scope (so independent cards can reorder).
 // No UI attributes/classes, hidden-state or transient form properties enter it.
 const transparent='[data-hs-straytext],[data-review-mark],[data-review-comment],[data-review-del]';
 const omitted='script,style,head,meta,link,title,template,[data-review-overlay],[data-review-point],[data-review-ins],.marker';
 function snapshot(){
  const records=new Map();
  function childrenOf(el){const parts=[];for(const n of el.childNodes){if(n.nodeType===3)parts.push({value:n.data});else if(n.nodeType===1&&!n.matches(omitted)){if(n.matches(transparent))parts.push(...childrenOf(n));else parts.push({node:n,children:childrenOf(n)})}}
   const merged=[];for(const p of parts){const last=merged.at(-1);if(!p.node&&last&&!last.node)last.value+=p.value;else merged.push(p)}return merged.filter(p=>p.node||norm(p.value))}
  function build(parts,path){return parts.map((p,i)=>{if(!p.node)return norm(p.value);const el=p.node,at=[...path,i],value=[el.localName,identity(el),el.getAttribute('src')||'',el.getAttribute('alt')||'',el.getAttribute('href')||'',build(p.children,at)];records.set(el,{path:at,value});return value})}
  const value=build(childrenOf(root),[]),identities=new Map();for(const [el] of records){const id=identity(el);if(id){const key=JSON.stringify([el.localName,id]);identities.set(key,(identities.get(key)||0)+1)}}
  const scopes=new Map([[root,{path:[],value:['root',value]}]]);for(const [el,r] of records){const id=identity(el);if(id&&identities.get(JSON.stringify([el.localName,id]))===1)scopes.set(el,r)}
  return {records,scopes,key:JSON.stringify(value)};
 }
 // Identified elements have authoritative identity: child reordering may move
 // their geometry, but not their identity. Guard the complete subtree while
 // canonicalizing only identified child order; anonymous paths remain ordered.
 function selfValue(value){if(!Array.isArray(value))return value;const loose=[],identified=[];for(const c of value[5])(Array.isArray(c)&&c[1]?identified:loose).push(selfValue(c));identified.sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);return [...value.slice(0,5),[loose,identified]]}
 function scopeFor(s,el){for(let n=el;n&&n!==root;n=n.parentElement)if(s.scopes.has(n))return n;return root}
 function unchanged(s){const now=snapshot();return now.key===s.key&&now.records.size===s.records.size&&[...s.records.keys()].every(el=>now.records.has(el))}
 async function anchor(el){if(target(el)!==el)return null;const s=snapshot(),r=s.records.get(el);if(!r)return null;const scope=s.scopes.get(scopeFor(s,el)),path=r.path.slice(scope.path.length).map(n=>n.toString(36)).join('.')||'self',digest=await hash(JSON.stringify(path==='self'?selfValue(scope.value):scope.value)),a='c3:'+digest+':'+path;
  if(a.length>200||!unchanged(s))return null;const prior=bindings.get(a);if(prior&&prior!==el)return null;bindings.set(a,el);return a}
 async function resolve(a){
  if(typeof a!=='string')return null;const bound=bindings.get(a);if(bound&&(!bound.isConnected||!root.contains(bound)))return null;
  const matches=[];
  if(/^c3:[a-f0-9]{64}:(?:self|[0-9a-z]+(?:\.[0-9a-z]+)*)$/.test(a)&&a.length<=256){
   const s=snapshot(),[,digest,path]=a.split(':'),scopes=path==='self'?[...s.scopes].filter(([el])=>el!==root):[...s.scopes];const hashes=await Promise.all(scopes.map(([,r])=>hash(JSON.stringify(path==='self'?selfValue(r.value):r.value))));if(!unchanged(s))return null;
   for(let i=0;i<scopes.length;i++)if(hashes[i]===digest){const [scope,r]=scopes[i];for(const [el,rec] of s.records)if(scopeFor(s,el)===scope&&(rec.path.slice(r.path.length).map(n=>n.toString(36)).join('.')||'self')===path&&target(el)===el)matches.push(el)}
  }else if(/^c2:[a-f0-9]{64}$/.test(a)){
   // Legacy is exact/unique only. Never quote-search or migrate old records.
   const candidates=nodes(),sigs=candidates.map(signature),hashes=await Promise.all(sigs.map(hash));for(let i=0;i<candidates.length;i++)if('c2:'+hashes[i]===a&&candidates[i].isConnected&&root.contains(candidates[i])&&signature(candidates[i])===sigs[i])matches.push(candidates[i]);
   if(!nodes().every((n,i)=>n===candidates[i]&&signature(n)===sigs[i])||nodes().length!==candidates.length)return null;
  }else return null;
  const result=matches.length===1?matches[0]:null;if(!result||bound&&bound!==result)return null;bindings.set(a,result);return result;
 }
 function box(){const n=doc.createElement('div');n.dataset.reviewOverlay='';n.dataset.reviewPicked='';n.setAttribute('aria-hidden','true');n.style.cssText='position:fixed;pointer-events:none;z-index:2147483646;border:1px solid #71a087;border-radius:2px;box-sizing:border-box;display:none';doc.documentElement.append(n);return n}
 let outline=null,corner=null;
 function paint(){const el=chosen||hover;if(picked&&el===chosen&&chosen?.isConnected){const r=chosen.getBoundingClientRect();onPick({...picked,rect:{left:r.left,top:r.top,width:r.width,height:r.height}})}if(!outline&&el){outline=box();corner=doc.createElement('span');corner.dataset.reviewOverlay='';corner.textContent='◯';corner.style.cssText='position:absolute;right:0;top:0;transform:translateY(-50%);font:12px/18px system-ui;color:#285d48;background:#edf6ef;border:1px solid #9dc1ab;border-radius:9px;width:18px;height:18px;text-align:center';outline.append(corner)}if(!outline)return;if(!el?.isConnected||(!enabled()&&!revealing)){outline.style.display='none';return}const r=el.getBoundingClientRect();Object.assign(outline.style,{display:'block',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',borderStyle:'solid'});corner.style.transform=r.top<10?'none':'translateY(-50%)'}
 function label(el){return el.localName+(el.id?' #'+el.id:'')+': '+norm(el.getAttribute('aria-label')||el.getAttribute('alt')||el.textContent).slice(0,55)}
 async function pick(el){const ticket=++epoch;revealing=false;chosen=el;picked=null;hover=null;paint();const a=await anchor(el);if(ticket!==epoch||!enabled()||chosen!==el)return;if(!a){clear();return;}const r=el.getBoundingClientRect(),p=target(el.parentElement);picked={anchor:a,quote:label(el),snippet:label(el),tag:el.localName,context:norm(el.getAttribute('aria-label')||el.getAttribute('alt')||el.textContent).slice(0,100000),textAnchor:el.dataset.hsAnchor||null,isText:false,parent:!!p};onPick({...picked,rect:{left:r.left,top:r.top,width:r.width,height:r.height}})}
 function clear(){revealing=false;epoch++;clearTimeout(timer);chosen=null;picked=null;hover=null;press=null;paint();onCancel()}
 function stop(e,prevent=false){if(prevent)e.preventDefault();e.stopImmediatePropagation()}
 function selection(){const s=win.getSelection();return s&&!s.isCollapsed&&s.toString().trim()&&root.contains(s.anchorNode)&&root.contains(s.focusNode)}
 // Window capture precedes document/page handlers, including handlers registered
 // before DOMContentLoaded. Do not cancel down defaults: native range/touch scroll.
 // Only a completed primary blank tap dismisses. Never consume it, and never
 // treat another eligible target (or a review-generated control) as blank.
 let blankPress=null;
 const blank=node=>node===root||node===doc.body||node===doc.documentElement;
 win.addEventListener('pointerdown',e=>{blankPress=enabled()&&e.button===0&&blank(e.target)?{x:e.clientX,y:e.clientY,id:e.pointerId}:null},true);
 win.addEventListener('pointerup',e=>{const p=blankPress;blankPress=null;if(p&&enabled()&&p.id===e.pointerId&&blank(e.target)&&Math.hypot(e.clientX-p.x,e.clientY-p.y)<8)clear()},true);
 for(const type of ['pointerdown','mousedown','touchstart'])win.addEventListener(type,e=>{if(!enabled()||!target(e.target))return;if(type==='pointerdown'){clearTimeout(timer);epoch++;press={x:e.clientX,y:e.clientY,el:target(e.target)}}stop(e,type!=='touchstart'&&!!e.target.closest?.('input,textarea,select'))},true);
 for(const type of ['pointerup','mouseup','touchend'])win.addEventListener(type,e=>{if(!enabled()||!target(e.target))return;stop(e);if(type!=='pointerup')return;const p=press;press=null;clearTimeout(timer);timer=win.setTimeout(()=>{if(!enabled())return;if(selection()&&(!p||win.getSelection().getRangeAt(0).intersectsNode(p.el))){chosen=null;paint();onText();return}if(p&&Math.hypot(e.clientX-p.x,e.clientY-p.y)<8){win.getSelection()?.removeAllRanges();pick(p.el)}},320)},true);
 for(const type of ['click','dblclick','auxclick','submit'])win.addEventListener(type,e=>{if(enabled()&&target(e.target)){stop(e,true);if(type==='click'&&!selection()&&e.target.closest?.('[data-thread]')){clearTimeout(timer);press=null;epoch++;chosen=null;hover=null;paint();const ids=[...new Set(doc.elementsFromPoint(e.clientX,e.clientY).filter(n=>n.dataset.thread).map(n=>n.dataset.thread))];onThread(ids)}}},true);
 win.addEventListener('pointermove',e=>{if(!enabled()||!target(e.target))return;stop(e);if(press)return;hover=target(e.target);paint()},true);
 win.addEventListener('pointercancel',()=>{blankPress=null;press=null;clearTimeout(timer)},true);
 win.addEventListener('keydown',e=>{if(!enabled()||e.target?.nodeType!==1||!root.contains(e.target))return;if(e.key==='Escape'){stop(e,true);clear();return}if(e.key!=='Tab'&&e.target.closest?.('input,textarea,select')){stop(e,true);if(['Enter',' '].includes(e.key))pick(target(e.target));return}if(['Enter',' '].includes(e.key)&&e.target.closest?.('[data-thread]')){stop(e,true);const ids=[];for(let n=e.target;n&&n!==root;n=n.parentElement)if(n.dataset?.thread)ids.push(n.dataset.thread);onThread(ids);return}if(['Enter',' '].includes(e.key)&&target(e.target)){stop(e,true);pick(target(e.target));return}if(target(e.target))stop(e)},true);
 win.addEventListener('keyup',e=>{if(!enabled()||!target(e.target)||e.key==='Tab')return;stop(e);if(selection())onText()},true);
 win.addEventListener('keypress',e=>{if(enabled()&&target(e.target))stop(e,true)},true);
 doc.addEventListener('selectionchange',()=>{if(enabled()&&selection()){chosen=null;hover=null;paint()}});
 win.addEventListener('scroll',paint,true);win.addEventListener('resize',paint);
 return {resolve,anchor,clear,refresh:paint,async navigate(direction){if(direction!=='parent'||!enabled()||!chosen?.isConnected)return;const next=target(chosen.parentElement);if(next)await pick(next)},async reveal(a){const ticket=++epoch,el=await resolve(a);if(ticket!==epoch)return false;if(el){revealing=true;chosen=el;picked=null;paint();win.setTimeout(()=>{if(ticket===epoch){revealing=false;paint()}},1800)}else{revealing=false;chosen=null;picked=null;hover=null;paint()}return el}};
}
