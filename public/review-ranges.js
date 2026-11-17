import {t} from './i18n.js';
import {logicalText,logicalRange,legacyMathLocation} from './logical-text.js';
// UTF-16 DOM coordinates, matching Selection and the persisted API ranges.
// Native triple-click can end at the next block's offset 0. Accept only an
// equivalent DOM boundary, never text (or a whole empty sibling) beyond it.
export function singleBlockRange(source,expected=null) {
 const r=source.cloneRange(),node=r.startContainer.nodeType===1?r.startContainer:r.startContainer.parentElement;
 const el=expected||node.closest?.('[data-hs-anchor]');
 if(!el||!el.contains(r.startContainer))return null;
 if(!el.contains(r.endContainer)){
  const edge=(node,offset)=>{while(node.parentNode){const length=node.nodeType===3?node.length:node.childNodes.length;if(offset!==0&&offset!==length)break;const end=offset!==0,index=Array.prototype.indexOf.call(node.parentNode.childNodes,node);node=node.parentNode;offset=index+(end?1:0)}return {node,offset}};
  const end=edge(r.endContainer,r.endOffset),limit=edge(el,el.childNodes.length);
  if(end.node!==limit.node||end.offset<limit.offset)return null;
  // Pretty-printed HTML may have indentation between otherwise adjacent blocks.
  // Never skip an element (including an empty paragraph), only HTML whitespace.
  if(end.offset!==limit.offset&&![...limit.node.childNodes].slice(limit.offset,end.offset).every(n=>n.nodeType===3&&/^[\t\n\f\r ]*$/.test(n.data)))return null;
  r.setEnd(el,el.childNodes.length);
 }
 return {el,range:r};
}
// Comment-only rendered prose. Never rescue an invalid canonical/cross-block
// range, or manufacture a source anchor for supplementary runtime content.
export function renderedTextRange(source) {
 const node=source.startContainer.nodeType===1?source.startContainer:source.startContainer.parentElement;
 if(!node||node.closest('[data-hs-anchor],input,textarea,select,button,[contenteditable="true"],[data-review-ins],[data-review-del],[data-review-overlay]'))return null;
 const blocks='p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,figcaption,dt,dd,caption,td,th,div';
 const el=node.closest(blocks);
 if(!el||el.querySelector(blocks)||el.querySelector('[data-hs-anchor],input,textarea,select,button,[contenteditable="true"]'))return null;
 const win=el.ownerDocument.defaultView;
 for(let n=el;n;n=n.parentElement){const css=win.getComputedStyle(n);if(n.hidden||css.display==='none'||css.visibility==='hidden'||css.visibility==='collapse')return null}
 const block=singleBlockRange(source,el);
 return block&&block.range.getClientRects().length?block:null;
}
export function textOf(node, exclude='[data-review-del],[data-review-point]') {
 return logicalText(node,exclude);
}
export function rangeAt(el,start,end,exclude='[data-review-ins],[data-review-point]') {
 return logicalRange(el,start,end,exclude);
}
export function difference(before,after) {
 let a=0,z=0;while(a<before.length&&a<after.length&&before[a]===after[a])a++;
 while(z<before.length-a&&z<after.length-a&&before[before.length-1-z]===after[after.length-1-z])z++;
 // Do not split a surrogate pair at a common-prefix/suffix boundary.
 if(a>0&&/[\uD800-\uDBFF]/.test(before[a-1]))a--;
 if(z>0&&/[\uDC00-\uDFFF]/.test(before[before.length-z]))z--;
 return {start:a,end:before.length-z,old:before.slice(a,before.length-z),next:after.slice(a,after.length-z)};
}
export function locateRecord(s,text,decode=x=>x,el=null) {
 const base=decode(s.base_text||''), quote=decode(s.quote||'');
 if(s.status==='accepted'&&s.kind==='rewrite')return {fallback:true,get reason(){return t('notice.acceptedLocation')}};
 if(base&&base!==text){const legacy=el&&legacyMathLocation(el,base,quote,s.range_start,s.range_end);return legacy||{stale:true,get reason(){return t('notice.paragraphChanged')}};}
 if(Number.isInteger(s.range_start)&&s.range_start>=0&&Number.isInteger(s.range_end)&&s.range_end>=s.range_start){
  if(base!==text||text.slice(s.range_start,s.range_end)!==quote)return {stale:true,get reason(){return t('notice.rangeStale')}};
  return {start:s.range_start,end:s.range_end};
 }
 if(Number(s.span_occ)>=0){
  if(!quote)return {stale:true,get reason(){return t('notice.legacyNoQuote')}};
  if(!base&&text.split(quote).length!==2)return {stale:true,get reason(){return t('notice.legacyAmbiguous')}};
  let p=-1,from=0;for(let n=0;n<=Number(s.span_occ);n++){p=text.indexOf(quote,from);if(p<0)return {stale:true,get reason(){return t('notice.quoteMissing')}};from=p+quote.length}
  return {start:p,end:p+quote.length};
 }
 if(!quote||quote===text)return {start:0,end:text.length};
 const p=text.indexOf(quote);if(p>=0&&text.indexOf(quote,p+quote.length)<0)return {start:p,end:p+quote.length};
 return {fallback:true,get reason(){return t('notice.legacyParagraph')}};
}
