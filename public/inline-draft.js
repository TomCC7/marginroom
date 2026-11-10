import {difference} from './review-ranges.js';
// Shared with the opaque static frame. Only an explicit command can start this
// projection. The native editable node is never replaced on input (IME/undo).
export function inlineDraftController({doc,onChange,onKey}){
 let current=null;
 function offsets(el,start,end){const w=doc.createTreeWalker(el,4);let n,p=0,a,b,ao,bo;while(n=w.nextNode()){if(n.parentElement.closest('[data-review-ins],[data-review-point]'))continue;if(!a&&p+n.length>=start){a=n;ao=start-p}if(p+n.length>=end){b=n;bo=end-p;break}p+=n.length}if(!a||!b)return null;const r=doc.createRange();r.setStart(a,ao);r.setEnd(b,bo);return r}
 function restoreSelection(el,start,end){const r=offsets(el,start,end);if(r){const s=doc.defaultView.getSelection();s.removeAllRanges();s.addRange(r)}}
 // Paint only the actual change. CSS Highlights and an out-of-flow deletion
 // label never mutate the active editable tree, so native undo/IME keep owning it.
 function paint(){if(!current)return;const c=current,win=doc.defaultView,d=difference(c.old,c.ins.textContent),changed=c.old!==c.ins.textContent;
  c.del.textContent=changed?d.old:'';c.del.hidden=!changed||!d.old;
  const r=offsets(c.ins,d.start,d.start+d.next.length),highlights=win.CSS?.highlights;
  if(highlights){highlights.delete('inline-draft-insert');if(changed&&d.next&&r)highlights.set('inline-draft-insert',new win.Highlight(r))}
  if(!c.del.hidden){const at=offsets(c.ins,d.start,d.start),box=at?.getBoundingClientRect(),fallback=c.ins.getBoundingClientRect(),style=win.getComputedStyle(c.ins),b=box?.width||box?.height?box:fallback;c.del.style.font=style.font;const label=c.del.getBoundingClientRect();let left=b.left,top=b.top-label.height;
   // At the viewport's first line use the text gutter, not a clipped badge.
   if(top<0){left=b.left-label.width;top=b.top;if(left<0){left=b.left;top=b.bottom}}
   c.del.style.left=Math.max(0,Math.min(win.innerWidth-label.width,left))+'px';c.del.style.top=Math.max(0,top)+'px'}
 }
 function measure(){if(!current)return;paint();const r=current.ins.getBoundingClientRect();onChange({body:current.ins.textContent,composing:current.composing,rect:{left:r.left,top:r.top,width:r.width,height:r.height}})}
 function stop(restore=true){if(!current)return;const c=current;current=null;c.del.remove();doc.defaultView.CSS?.highlights?.delete('inline-draft-insert');if(restore){c.el.innerHTML=c.html;const r=offsets(c.el,c.start,c.end);if(r){const s=doc.defaultView.getSelection();s.removeAllRanges();s.addRange(r)}}}
 function start(el,start,end){stop();const r=offsets(el,start,end);if(!r)return false;const html=el.innerHTML,old=r.toString(),del=doc.createElement('del'),ins=doc.createElement('ins');del.dataset.inlineOld='';del.contentEditable='false';del.textContent=old;del.hidden=true;ins.dataset.inlineEditor='';ins.contentEditable='true';ins.setAttribute('role','textbox');ins.setAttribute('aria-label','原位修改草稿');ins.append(r.cloneContents());r.deleteContents();r.insertNode(ins);doc.body.append(del);current={el,html,old,start,end,del,ins,composing:false};ins.focus({preventScroll:true});const selected=doc.createRange();selected.selectNodeContents(ins);selected.collapse(false);const s=doc.defaultView.getSelection();s.removeAllRanges();s.addRange(selected);measure();return true}
 doc.addEventListener('beforeinput',e=>{if(!current||!current.ins.contains(e.target))return;if(['insertParagraph','insertLineBreak'].includes(e.inputType)){e.preventDefault();onKey('submit');return}const s=doc.defaultView.getSelection();if(!s.rangeCount||!current.ins.contains(s.getRangeAt(0).startContainer)||!current.ins.contains(s.getRangeAt(0).endContainer))e.preventDefault()});
 doc.addEventListener('input',e=>{if(current&&current.ins.contains(e.target)){current.del.hidden=current.ins.textContent===current.old;measure()}});
 doc.addEventListener('compositionstart',e=>{if(current&&current.ins.contains(e.target))current.composing=true});
 doc.addEventListener('compositionend',e=>{if(current&&current.ins.contains(e.target)){current.composing=false;current.del.hidden=current.ins.textContent===current.old;measure()}});
 doc.addEventListener('paste',e=>{if(!current||!current.ins.contains(e.target))return;e.preventDefault();const t=e.clipboardData.getData('text/plain');if(/[\r\n]/.test(t))return;doc.execCommand('insertText',false,t)});
 doc.addEventListener('keydown',e=>{if(!current||!current.ins.contains(e.target))return;if(e.key==='Escape'||(e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();e.stopImmediatePropagation();onKey(e.key==='Escape'?'cancel':'submit')}} ,true);
 doc.defaultView.addEventListener('scroll',measure,true);doc.defaultView.addEventListener('resize',measure);
 return {start,stop,measure,restoreSelection,get active(){return !!current},get anchor(){return current?.el.dataset.hsAnchor}};
}
export const inlineDraftCSS='[data-inline-editor]{color:inherit;background:transparent;text-decoration:none;outline:1px solid #76a68b;min-width:2px;white-space:pre-wrap}::highlight(inline-draft-insert){color:#205b40;background:#dcf0e2;text-decoration:underline}[data-inline-old]{position:fixed;z-index:2147483000;line-height:1!important;max-width:90vw;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none;color:#944b45;background:#f9e0dd;text-decoration:line-through;user-select:none}[data-inline-old][hidden]{display:none!important}';
