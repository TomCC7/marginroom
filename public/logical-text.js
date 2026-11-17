// Logical source text. UTF-16 throughout; never remove accessible author markup.
export function mathHidden(node) {
 const el=node.nodeType===1?node:node.parentElement;
 if(!el)return false;
 if(el.closest?.('annotation,annotation-xml,mphantom'))return true;
 const hidden=el.closest?.('.katex-mathml');
 return !!(hidden&&hidden.parentElement?.querySelector('.katex-html'));
}
export function logicalNodes(root,exclude='') {
 const out=[];
 function walk(node){
  if(mathHidden(node)||exclude&&node.nodeType===1&&node.matches?.(exclude))return;
  if(node.nodeType===3){if(!exclude||!node.parentElement?.closest(exclude))out.push(node);return;}
  for(const child of node.childNodes||[])walk(child);
 }walk(root);return out;
}
export function logicalText(root,exclude='') {return logicalNodes(root,exclude).map(n=>n.textContent).join('');}
export function logicalOffset(root,node,offset,exclude='') {
 const doc=root.ownerDocument,r=doc.createRange();r.selectNodeContents(root);try{r.setEnd(node,offset);}catch{return null;}
 let pos=0;for(const n of logicalNodes(root,exclude)){
  if(n===node)return pos+offset;
  if(r.comparePoint(n,0)===1)break;
  pos+=n.textContent.length;
 }return pos;
}
export function logicalRange(root,start,end,exclude='') {
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start)return null;
 const nodes=logicalNodes(root,exclude),doc=root.ownerDocument;let pos=0,sn,en,so,eo;
 for(const n of nodes){const last=pos+n.textContent.length;if(!sn&&start<=last){sn=n;so=start-pos;}if(end<=last){en=n;eo=end-pos;break;}pos=last;}
 if(!sn||!en){if(!start&&!end&&!nodes.length){const r=doc.createRange();r.selectNodeContents(root);r.collapse(true);return r;}return null;}
 const r=doc.createRange();r.setStart(sn,so);r.setEnd(en,eo);return r;
}
// Nonlinear layout has no honest character-order promise. Element comments remain available.
export function logicalSelection(root,range,exclude='') {
 if(!root.contains(range.startContainer)||!root.contains(range.endContainer)||mathHidden(range.startContainer)||mathHidden(range.endContainer))return null;
 for(const n of root.querySelectorAll('mfrac,msqrt,mroot,msup,msub,msubsup,munder,mover,munderover,mmultiscripts,maction,menclose,mtable,.katex .vlist-t'))if(!mathHidden(n)&&range.intersectsNode(n))return null;
 const start=logicalOffset(root,range.startContainer,range.startOffset,exclude),end=logicalOffset(root,range.endContainer,range.endOffset,exclude);
 if(start===null||end===null||end<start)return null;
 return {start,end,quote:logicalText(root,exclude).slice(start,end)};
}
// Exact compatibility bridge for old raw-text ranges. Never search nearby prose.
export function legacyMathLocation(root,base,quote,start,end) {
 const nodes=[];function walk(n){if(n.nodeType===1&&n.matches('[data-review-ins],[data-review-point]'))return;if(n.nodeType===3)nodes.push(n);else for(const c of n.childNodes||[])walk(c);}walk(root);
 if(nodes.map(n=>n.textContent).join('')!==base||base===logicalText(root,'[data-review-ins],[data-review-point]'))return null;
 if(!Number.isInteger(start)||!Number.isInteger(end)){start=base.indexOf(quote);if(!quote||start<0||base.indexOf(quote,start+1)>=0)return null;end=start+quote.length;}
 if(start<0||end<start||base.slice(start,end)!==quote)return null;
 let pos=0,sn,en,so,eo;for(const n of nodes){const last=pos+n.length;if(!sn&&start<last){sn=n;so=start-pos;}if(end<=last){en=n;eo=end-pos;break;}pos=last;}
 if(!sn||!en)return null;const r=root.ownerDocument.createRange();r.setStart(sn,so);r.setEnd(en,eo);
 const loc=logicalSelection(root,r,'[data-review-ins],[data-review-point]');return loc&&loc.quote===quote?{start:loc.start,end:loc.end}:null;
}
export function logicalSource(){return [mathHidden,logicalNodes,logicalText,logicalOffset,logicalRange,logicalSelection,legacyMathLocation].map(String).join('\n');}
