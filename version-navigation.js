import {sourceParagraphs,resolveParagraph} from './revision-service.js';
import {locateRecord} from './public/review-ranges.js';
import {plainText,getOverlay} from './db.js';
// Navigation only: reuse exact source anchors AND full original paragraph context.
export function locateAcross(db,record,source,target){
 const unavailable=reason=>({status:'unavailable',reason});
 if(!/^[a-f0-9]{64}(?:#[1-9][0-9]*)?$/.test(record.anchor||''))return unavailable('unsupported_or_runtime_anchor');
 if(record.kind==='rewrite'&&record.status!=='open')return unavailable('handled_revision_not_replayed');
 if(!record.base_text)return unavailable('original_context_missing');
 let original;try{original=resolveParagraph(source,record.anchor);}catch{return unavailable('original_anchor_unverifiable');}
 original=plainText(getOverlay(db,record.doc_id)[record.anchor]?.text??original);
 if(original!==plainText(record.base_text))return unavailable('original_context_changed');
 const candidates=sourceParagraphs(target.html).filter(p=>p.norm===sourceParagraphs(source).find(p=>p.anchor===record.anchor)?.norm);
 if(candidates.length>1)return {status:'ambiguous',reason:'duplicate_paragraph_context'};
 if(!candidates.length)return {status:'not_found',reason:'original_paragraph_removed_or_changed'};
 const candidate=candidates[0],text=plainText(getOverlay(db,target.doc)[candidate.anchor]?.text??candidate.text);
 if(text!==original)return {status:'not_found',reason:'target_context_changed'};
 const location=locateRecord(record,text,plainText);if(location.stale||location.fallback)return unavailable('range_context_unverifiable');
 return {status:'located',reason:'unique_exact_paragraph_and_range',anchor:candidate.anchor,start:location.start,end:location.end};
}
