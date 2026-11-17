import {assignAnchors} from './public/anchoring.js';
import {parseHTML} from 'linkedom';
import {parse,serialize} from 'parse5';
function parsedSource(html,cache){
 if(!cache.has(html)){const {document}=parseHTML(serialize(parse(html)));cache.set(html,{document,picker:elementReview({root:document.documentElement,hash:async value=>digest(value),enabled:()=>false,onPick:()=>{}})});}
 return cache.get(html);
}
import {elementReview} from './public/element-review.js';
import {digest} from './machine-auth.js';
import {locateRecord} from './public/review-ranges.js';
import {plainText,getOverlay} from './db.js';
import {logicalText,logicalNodes,mathHidden} from './public/logical-text.js';
// Same legacy raw→logical coordinate contract without requiring browser Range APIs.
function elementLocation(record,el){
 const text=logicalText(el),base=plainText(record.base_text||''),quote=plainText(record.quote||'');
 const nonlinear=[...el.querySelectorAll('mfrac,msqrt,mroot,msup,msub,msubsup,munder,mover,munderover,mmultiscripts,maction,menclose,mtable,.katex .vlist-t')].some(n=>!mathHidden(n));
 if(nonlinear)return null;
 const loc=locateRecord(record,text,plainText);
 if(!loc.stale&&!loc.fallback)return loc;
 const raw=el.textContent;if(!base||base!==raw)return null;
 let start=record.range_start,end=record.range_end;
 if(!Number.isInteger(start)||!Number.isInteger(end)){start=raw.indexOf(quote);if(!quote||start<0||raw.indexOf(quote,start+1)>=0)return null;end=start+quote.length;}
 if(start<0||end<start||raw.slice(start,end)!==quote)return null;
 const visible=new Set(logicalNodes(el));let rawPos=0,logicalPos=0,a,b,hidden=false;
 function walk(n){if(n.nodeType===3){const z=rawPos+n.textContent.length;if(visible.has(n)){if(start>=rawPos&&start<z)a=logicalPos+start-rawPos;if(end>rawPos&&end<=z)b=logicalPos+end-rawPos;logicalPos+=n.textContent.length;}else if(start<z&&end>rawPos)hidden=true;rawPos=z;}else for(const c of n.childNodes||[])walk(c);}walk(el);
 return !hidden&&Number.isInteger(a)&&Number.isInteger(b)&&text.slice(a,b)===quote?{start:a,end:b}:null;
}
// Navigation only: reuse exact source anchors AND full original paragraph context.
export async function locateAcross(db,record,source,target,cache=new Map()){
 const unavailable=reason=>({status:'unavailable',reason});
 if(typeof source!=='string'||typeof target.html!=='string')return unavailable('source_unavailable');
 if(/^c[23]:/.test(record.anchor||'')){
  if(!record.source_hash||record.source_hash!==digest(source))return unavailable('original_source_changed_or_unverifiable');
  const resolve=async html=>{const value=parsedSource(html,cache);return {document:value.document,found:await value.picker.resolve(record.anchor)};};
  const {found:original}=await resolve(source);if(!original)return unavailable('original_element_unverifiable');
  const text=original.textContent.replace(/\s+/g,' ').trim();
  const {document,found}=await resolve(target.html);
  const duplicates=[...document.querySelectorAll(original.localName)].filter(el=>el.textContent.replace(/\s+/g,' ').trim()===text);
  if(duplicates.length>1)return {status:'ambiguous',reason:'duplicate_original_context'};
  if(!found)return {status:'not_found',reason:'element_scope_changed_or_removed'};
  if(found.textContent.replace(/\s+/g,' ').trim()!==text||logicalText(found)!==logicalText(original))return unavailable('element_context_changed');
  const ranged=Number.isInteger(record.range_start)||Number(record.span_occ)>=0;
  const loc=elementLocation(record,original),current=elementLocation(record,found);
  if(ranged&&(!loc||!current||loc.start!==current.start||loc.end!==current.end))return unavailable('range_context_unverifiable');
  return {status:'located',reason:'existing_element_locator_and_original_source_validated',anchor:record.anchor,...(current?{start:current.start,end:current.end,baseText:logicalText(found)}:{})};
 }
 if(!/^[a-f0-9]{64}(?:#[1-9][0-9]*)?$/.test(record.anchor||''))return unavailable('unsupported_or_runtime_anchor');
 if(record.kind==='rewrite'&&record.status!=='open')return unavailable('handled_revision_not_replayed');
 if(!record.base_text)return unavailable('original_context_missing');
 const originalParsed=parsedSource(source,cache),targetParsed=parsedSource(target.html,cache);
 const originals=await (originalParsed.anchors??=assignAnchors(originalParsed.document.body)),targets=await (targetParsed.anchors??=assignAnchors(targetParsed.document.body));
 const original=originals.get(record.anchor)||originals.legacy.get(record.anchor);
 if(!original||original.hasAttribute('data-hs-group'))return unavailable('original_anchor_unverifiable');
 const sourceOverlay=getOverlay(db,record.doc_id)[record.anchor];
 const originalText=sourceOverlay?plainText(sourceOverlay.text):logicalText(original);
 const candidates=[...targets.values()].filter(el=>logicalText(el)===logicalText(original));
 if(candidates.length>1)return {status:'ambiguous',reason:'duplicate_paragraph_context'};
 if(!candidates.length)return {status:'not_found',reason:'original_paragraph_removed_or_changed'};
 const candidate=candidates[0],anchor=candidate.dataset.hsAnchor;
 if(candidate.hasAttribute('data-hs-group'))return unavailable('grouped_target');
 const targetOverlay=getOverlay(db,target.doc)[anchor],text=targetOverlay?plainText(targetOverlay.text):logicalText(candidate);
 if(text!==originalText)return {status:'not_found',reason:'target_context_changed'};
 const location=sourceOverlay?locateRecord(record,originalText,plainText):elementLocation(record,original);
 const current=targetOverlay?locateRecord(record,text,plainText):elementLocation(record,candidate);
 if(!location||!current||location.stale||location.fallback||current.stale||current.fallback||location.start!==current.start||location.end!==current.end)return unavailable('range_context_unverifiable');
 return {status:'located',reason:'unique_exact_paragraph_and_range',anchor,start:current.start,end:current.end,baseText:text};
}
