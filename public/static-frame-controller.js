// Trusted controller only: uploaded scripts and event handlers are stripped.
(()=>{
 const token=window.__staticPreviewToken;delete window.__staticPreviewToken;
 const send=data=>parent.postMessage({channel:'static-preview',token,...data},'*');
 const find=a=>[...document.querySelectorAll('[data-hs-anchor],[data-hs-comment-anchor]')].find(n=>(n.dataset.hsAnchor||n.dataset.hsCommentAnchor)===a);
 const text=(node,exclude='[data-review-del],[data-review-point]')=>{const n=node.cloneNode(true);n.querySelectorAll?.(exclude).forEach(x=>x.remove());return n.textContent};
 const offset=(el,node,n)=>{const r=document.createRange();r.selectNodeContents(el);r.setEnd(node,n);return text(r.cloneContents()).length};
 function caret(el,n){const w=document.createTreeWalker(el,4);let t,pos=0;while(t=w.nextNode()){if(t.parentElement.closest('[data-review-del],[data-review-point]'))continue;if(pos+t.length>=n){const r=document.createRange();r.setStart(t,n-pos);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);return}pos+=t.length}}
 let composing=false,selectionTimer,mode='read',pickedSelection=null;
 function selectionStamp(){const s=getSelection();if(!s.rangeCount||s.isCollapsed)return null;const r=s.getRangeAt(0);return [r.startContainer,r.startOffset,r.endContainer,r.endOffset]}
 function sameSelection(a,b){return a&&b&&a.every((v,i)=>v===b[i])}
 let inlineRequest=null;
 const inline=inlineDraftController({doc:document,onChange:m=>send({type:'inline-change',requestId:inlineRequest,...m}),onKey:key=>send({type:'inline-key',requestId:inlineRequest,key})});
 const marks=annotationAffordances({doc:document,onOpen:ids=>send({type:'thread',id:ids[0],ids})});
 const picker=elementReview({root:document.body,hash:sha256hex,enabled:()=>mode==='suggest'&&!inline.active,onPick:t=>{pickedSelection=selectionStamp();send({type:'elementTarget',...t})},onThread:ids=>send({type:'thread',id:ids[0],ids}),onText:()=>{pickedSelection=null;selection()},onCancel:()=>send({type:'targetCleared'})});
 // Scroll only this document's owners. Native scrollIntoView may also pan the
 // embedding shell, moving its toolbar and invalidating a scaled target rect.
 function reveal(el){for(let p=el.parentElement;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement){const r=el.getBoundingClientRect(),b=p.getBoundingClientRect(),css=getComputedStyle(p);if(/auto|scroll/.test(css.overflowY)&&p.scrollHeight>p.clientHeight)p.scrollTop+=r.top-b.top-(p.clientHeight-r.height)/2;if(/auto|scroll/.test(css.overflowX)&&p.scrollWidth>p.clientWidth)p.scrollLeft+=r.left-b.left-(p.clientWidth-r.width)/2}const r=el.getBoundingClientRect();scrollBy(r.left-(innerWidth-r.width)/2,r.top-(innerHeight-r.height)/2);const b=el.getBoundingClientRect();send({type:'located',rect:{left:b.left,top:b.top,width:b.width,height:b.height}})}
 window.addEventListener('message',e=>{
  const m=e.data;if(e.source!==parent||!m||m.channel!=='static-preview'||m.token!==token)return;
  if(m.type==='sync'){const previous=mode;mode=m.mode;if(previous!==mode&&mode!=='suggest')picker.clear()}
  if(m.type==='targetNavigate'&&mode==='suggest'&&!inline.active)picker.navigate(m.direction);
  if(m.type==='clearTarget')picker.clear();
  if(m.type==='comment-groups')marks.sync(m.groups||[],m.mobile===true);
  if(m.type==='inline-start'){inlineRequest=m.requestId;const el=find(m.anchor);if(el&&Number.isInteger(m.start)&&Number.isInteger(m.end)){picker.clear();if(typeof m.html==='string')el.innerHTML=m.html;inline.start(el,m.start,m.end)}}
  if(m.type==='inline-stop'){inlineRequest=null;inline.stop()}
  if(m.type==='restore-selection'){const el=find(m.anchor);if(el)inline.restoreSelection(el,m.start,m.end)}
  if(m.type==='sync'&&Array.isArray(m.blocks))for(const b of m.blocks){const el=find(b.anchor);if(!el||inline.anchor===b.anchor)continue;
   if(el.innerHTML!==b.html){const s=getSelection(),n=s.rangeCount&&el.contains(s.focusNode)?offset(el,s.focusNode,s.focusOffset):null;
    // Keep native form state even when reviewer decoration changes the block.
    const controls=[...el.querySelectorAll('input,textarea,select')].map(n=>({value:n.value,checked:n.checked}));
    el.innerHTML=b.html;[...el.querySelectorAll('input,textarea,select')].forEach((n,i)=>{if(controls[i]){n.value=controls[i].value;n.checked=controls[i].checked}});
    if(n!==null)caret(el,n);
   }el.contentEditable=b.editable;el.title=b.title||'';el.dataset.reviewBlockThread=b.thread;
  }
  if(m.type==='locate'&&m.anchor?.startsWith('c2:')){picker.reveal(m.anchor).then(el=>{if(el)reveal(el);else send({type:'targetMissing',anchor:m.anchor})});return}
  if(m.type==='locate'){const el=document.querySelector(`[data-thread="${CSS.escape(m.id)}"]`)||find(m.anchor);if(el){reveal(el);el.classList.add('record-focus');setTimeout(()=>el.classList.remove('record-focus'),1800)}}
  if(m.type==='visibility'){const controls=[...document.querySelectorAll('input,textarea,select')];if(!m.active){window.__staticScroll={x:scrollX,y:scrollY};send({type:'suspended',forms:controls.map(n=>({value:n.value,checked:n.checked,selected:n.tagName==='SELECT'?[...n.options].map(o=>o.selected):null}))})}else{if(Array.isArray(m.forms))controls.forEach((n,i)=>{const v=m.forms[i];if(v){n.value=v.value;n.checked=v.checked;if(n.tagName==='SELECT'&&Array.isArray(v.selected))[...n.options].forEach((o,j)=>o.selected=v.selected[j]===true)}});if(window.__staticScroll){const p=window.__staticScroll;scrollTo(p.x,p.y);requestAnimationFrame(()=>scrollTo(p.x,p.y))}}}
  if(m.type==='clear-selection')getSelection().removeAllRanges();
  if(m.type==='measure-selection')selection(m.requestId);
 });
 function selection(requestId){if(inline.active)return;if(sameSelection(pickedSelection,selectionStamp()))return;pickedSelection=null;const empty=reason=>send({type:'selection',selection:null,reason,requestId}),s=getSelection();if(!s.rangeCount||s.isCollapsed){empty('collapsed');return}const block=singleBlockRange(s.getRangeAt(0));if(!block){empty('invalid');return}const {range:r,el}=block,node=r.startContainer.nodeType===1?r.startContainer:r.startContainer.parentElement;if(node.closest('[data-review-ins]')||r.cloneContents().querySelector('[data-review-ins]')){empty('invalid');return}
  const pre=document.createRange();pre.selectNodeContents(el);pre.setEnd(r.startContainer,r.startOffset);const quote=text(r.cloneContents(),'[data-review-ins],[data-review-point]'),start=text(pre.cloneContents(),'[data-review-ins],[data-review-point]').length,rect=r.getBoundingClientRect();if(quote.trim())send({type:'selection',requestId,anchor:el.dataset.hsAnchor,selection:{quote,rangeStart:start,rangeEnd:start+quote.length,rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height}}});else empty('invalid');
 }
 document.addEventListener('selectionchange',()=>selection());
 document.addEventListener('pointerup',()=>selection());
 document.addEventListener('keyup',()=>selection());
 document.addEventListener('scroll',()=>{clearTimeout(selectionTimer);selectionTimer=setTimeout(selection,80)},true);
 window.addEventListener('resize',()=>{clearTimeout(selectionTimer);selectionTimer=setTimeout(selection,80)});
 function input(e){if(inline.active)return;const el=e.target.closest('[data-hs-anchor]');if(!el||composing)return;const s=getSelection();send({type:'input',anchor:el.dataset.hsAnchor,text:text(el),caret:s.rangeCount&&el.contains(s.focusNode)?offset(el,s.focusNode,s.focusOffset):null})}
 function editRange(el){const s=getSelection();if(!s.rangeCount)return false;const r=s.getRangeAt(0),block=singleBlockRange(r,el);if(!block)return false;if(!el.contains(r.endContainer)){s.removeAllRanges();s.addRange(block.range)}return true}
 document.addEventListener('beforeinput',e=>{const el=e.target.closest('[data-hs-anchor]');if(!el||el.contentEditable!=='true')return;if(!editRange(el)||mode==='suggest'&&['insertParagraph','insertLineBreak','historyUndo','historyRedo'].includes(e.inputType)){e.preventDefault();send({type:'key',key:e.inputType})}});
 document.addEventListener('input',input);document.addEventListener('compositionstart',()=>composing=true);document.addEventListener('compositionend',e=>{composing=false;input(e)});
 document.addEventListener('paste',e=>{const el=e.target.closest('[data-hs-anchor][contenteditable="true"]');if(!el)return;e.preventDefault();const t=e.clipboardData.getData('text/plain');if(!/[\r\n]/.test(t)&&editRange(el))document.execCommand('insertText',false,t)});
 document.addEventListener('click',e=>{const t=e.target.closest('[data-thread],[data-review-block-thread]');if(t&&(t.dataset.thread||t.dataset.reviewBlockThread)){send({type:'thread',id:t.dataset.thread||t.dataset.reviewBlockThread});return}const image=e.target.closest('[data-hs-comment-anchor]');if(image)send({type:'comment',anchor:image.dataset.hsCommentAnchor})});
 document.addEventListener('keydown',e=>{if(inline.active)return;if(e.key==='Escape'||(e.ctrlKey||e.metaKey)&&['Enter','z','Z'].includes(e.key)){e.preventDefault();send({type:'key',key:e.key,shift:!!e.shiftKey})}});
 send({type:'ready'});
})();
