// Server-authoritative continuous revisions. All reads/checks/writes below are
// synchronous inside one SQLite transaction; source is read inside that boundary.
import {parse} from 'parse5';
import {createHash,randomUUID} from 'node:crypto';
import {collectLeaves,groupText,normalizeText,BLOCK_TAGS,GROUP_ATTR,SKIP_TAGS} from './public/anchoring.js';
import {differences,project} from './public/revision-diff.js';
import {locateRecord} from './public/review-ranges.js';
import {rangesConflict} from './public/range-patches.js';
import {getOverlay,listSuggestions,addSuggestion,plainText,getSuggestion,setSuggestionStatus,acceptSuggestion} from './db.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export class RevisionError extends Error {
  constructor(status,error,extra={}){super(error);this.status=status;this.response={error,...extra}}
}
const fail=(status,error,extra)=>{throw new RevisionError(status,error,extra)};

// A deliberately small DOM facade permits reuse of the viewer's actual leaf
// collector rather than a second, subtly different block/occurrence algorithm.
function facade(node,parent=null){
 const el={tagName:(node.tagName||'').toUpperCase(),parentElement:parent,
  hasAttribute:name=>(node.attrs||[]).some(a=>a.name===name),
  get textContent(){return node.nodeName==='#text'?node.value:(this.childNodes||[]).map(c=>c.textContent).join('')},
  querySelectorAll(){const out=[];const walk=p=>{for(const c of p.children){if(c.hasAttribute(GROUP_ATTR)||BLOCK_TAGS.has(c.tagName.toLowerCase()))out.push(c);walk(c)}};walk(this);return out},
  namespace:node.namespaceURI};
 el.childNodes=(node.childNodes||[]).map(c=>facade(c,el));el.children=el.childNodes.filter(c=>c.tagName);return el;
}
export function resolveParagraph(html,anchor,config={}){
 if(typeof anchor!=='string'||!/^[a-f0-9]{64}(?:#[1-9][0-9]*)?$/.test(anchor))fail(422,'unsupported_anchor');
 // Selector-configured sections require browser CSS matching; do not guess.
 if(config?.groups?.length)fail(422,'unsupported_anchor');
 const root=facade(parse(html)),body=root.children.find(c=>c.tagName==='HTML')?.children.find(c=>c.tagName==='BODY');
 if(!body)fail(422,'unsupported_anchor');
 const seen=new Map();
 for(const el of collectLeaves(body)){
  const grouped=el.hasAttribute(GROUP_ATTR),norm=grouped?groupText(el):normalizeText(el.textContent);
  if(!norm)continue;const digest=hash(norm),occ=seen.get(digest)||0;seen.set(digest,occ+1);
  if(anchor!==(occ?`${digest}#${occ}`:digest))continue;
  // Groups, foreign namespaces and active/non-text descendants aren't safe
  // single-paragraph text scopes. Generated runtime-only nodes never resolve.
  let unsafe=grouped;for(let p=el;p&&p!==body;p=p.parentElement)if(SKIP_TAGS.has(p.tagName.toLowerCase())||p.namespace!=='http://www.w3.org/1999/xhtml')unsafe=true;
  const scan=p=>{for(const c of p.children){if(SKIP_TAGS.has(c.tagName.toLowerCase())||c.namespace!=='http://www.w3.org/1999/xhtml')unsafe=true;scan(c)}};scan(el);
  if(unsafe)fail(422,'unsupported_anchor');return el.textContent;
 }
 fail(422,'unsupported_anchor');
}
export const isSourceAnchor=anchor=>typeof anchor==='string'&&/^[a-f0-9]{64}(?:#[1-9][0-9]*)?$/.test(anchor);
export const affectedAnchors=record=>record.span_occ===-2&&record.anchor?.startsWith('m:')?record.anchor.slice(2).split(',').filter(Boolean):[record.anchor];
// Mutation scope is not display/quote scope: whole-block and packed rewrites
// replace every character even when their display quote is only a substring.
export function mutationLocation(record,base,sourceHash,anchor=record.anchor){
 if(record.source_hash&&sourceHash&&record.source_hash!==sourceHash)return null;
 if(record.span_occ===-2&&affectedAnchors(record).includes(anchor))return {start:0,end:base.length};
 if(record.range_start==null&&record.span_occ===-1){
  if(record.base_text&&plainText(record.base_text)!==base)return null;
  return {start:0,end:base.length};
 }
 const loc=locateRecord(record,base,plainText);
 return loc.stale||loc.fallback?null:loc;
}
const validLocation=mutationLocation;
// Preserve unchanged authored anchors before comparing the gaps. A global
// shortest script alone can realign an old word to a newly inserted distant
// repeated letter, needlessly changing stable records/discussions.
function authoredDifferences(base,before,after,owned){
 const edits=differences(before,after),mapping=project(before,edits),pins=[];let delta=0;
 for(const h of owned){const start=h.start+delta,end=start+h.next.length;delta+=h.next.length-(h.end-h.start);if(edits.some(e=>rangesConflict(e,{start,end})))continue;const at=mapping.forward(start,'right');if(after.slice(at,at+h.next.length)===h.next)pins.push({h,at})}
 const out=[];let a=0,b=0;for(const {h,at} of pins){for(const edit of differences(base.slice(a,h.start),after.slice(b,at)))out.push({...edit,start:edit.start+a,end:edit.end+a});out.push({start:h.start,end:h.end,old:h.old,next:h.next});a=h.end;b=at+h.next.length}for(const edit of differences(base.slice(a),after.slice(b)))out.push({...edit,start:edit.start+a,end:edit.end+a});const merged=[];for(const h of out){const last=merged.at(-1);if(last&&last.end===h.start){last.end=h.end;last.old+=h.old;last.next+=h.next}else merged.push({...h})}return merged;
}
export function revisionService(db,{readSource,readConfig=()=>({})}){
 function acceptedBase(docId,anchor,html=readSource(docId)){
  if(html==null)fail(404,'doc_not_found');
  // Resolve first even when an overlay exists: an orphan overlay is not source authority.
  const original=resolveParagraph(html,anchor,readConfig(docId)),entry=getOverlay(db,docId)[anchor];
  return entry?plainText(entry.text):original;
 }
 function validateLegacy(docId,record,html=readSource(docId)){
  for(const anchor of affectedAnchors(record)){
   if(!isSourceAnchor(anchor))continue; // Historical synthetic API IDs have no source address.
   let base;try{base=acceptedBase(docId,anchor,html)}catch(e){if(e instanceof RevisionError)fail(409,'span_stale');throw e}
   const expected=record.span_occ===-2?plainText(record.base_text||record.quote||'').split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean)[affectedAnchors(record).indexOf(anchor)]:plainText(record.base_text||'');
   if(expected!==base||record.source_hash&&record.source_hash!==hash(html))fail(409,'span_stale');
   if(record.span_occ!==-2&&!mutationLocation(record,base,hash(html)))fail(409,'span_stale');
  }
 }
 function checkLegacyOverlap(docId,record,html=readSource(docId)){
  const overlay=getOverlay(db,docId),sourceHash=hash(html);
  for(const anchor of affectedAnchors(record)){
   const base=isSourceAnchor(anchor)?acceptedBase(docId,anchor,html):plainText(overlay[anchor]?.text??record.base_text??'');
   const loc=mutationLocation(record,base,sourceHash,anchor);if(!loc)continue;
   for(const other of listSuggestions(db,docId,'open')){
    if(other.kind!=='rewrite'||!affectedAnchors(other).includes(anchor))continue;
    const existing=mutationLocation(other,base,sourceHash,anchor);
    if(existing&&rangesConflict(loc,existing))fail(409,'range_overlap',{existingId:other.id});
   }
  }
 }
 function state(docId,anchor,caller,html=readSource(docId)){
  if(html==null)fail(404,'doc_not_found');
  const original=resolveParagraph(html,anchor,readConfig(docId)),overlay=getOverlay(db,docId);
  const baseText=overlay[anchor]?plainText(overlay[anchor].text):original,sourceHash=hash(html);
  if(baseText.length>50000)fail(422,'revision_too_large');
  const rows=db.prepare("SELECT * FROM suggestions WHERE doc_id=? AND (anchor=? OR span_occ=-2) ORDER BY created_at,rowid").all(docId,anchor)
   .filter(row=>row.anchor===anchor||(row.anchor?.startsWith('m:')&&row.anchor.slice(2).split(',').includes(anchor)));
  const publicRows=new Map(listSuggestions(db,docId,'all').map(s=>[s.id,s]));
  const owned=[];const records=rows.map(row=>{
   const loc=validLocation(row,baseText,sourceHash);
   const canUpdate=!!caller&&row.request_caller===caller&&row.kind==='rewrite'&&row.status==='open'&&row.anchor===anchor&&!!loc;
   if(canUpdate)owned.push({row,...loc,old:baseText.slice(loc.start,loc.end),next:plainText(row.body||'')});
   return {...publicRows.get(row.id),canUpdate};
  });
  owned.sort((a,b)=>a.start-b.start||a.end-b.end);
  let proposedText;try{proposedText=project(baseText,owned).text}catch{fail(409,'revision_conflict')}
  const scopeKeys=new Set(['*',anchor,...rows.map(row=>row.anchor)]);
  const epochs=db.prepare('SELECT anchor,epoch FROM revision_scope_epochs WHERE doc_id=? ORDER BY anchor').all(docId).filter(row=>scopeKeys.has(row.anchor));
  const version=hash(JSON.stringify([docId,anchor,sourceHash,overlay[anchor]||null,rows,epochs]));
  return {snapshot:{anchor,baseText,proposedText,version,sourceHash,records},owned,rows};
 }
 const snapshot=db.transaction((docId,anchor,caller)=>state(docId,anchor,caller).snapshot);
 const reconcile=db.transaction((docId,caller,input)=>{
  const {anchor,version,sourceHash,proposedText,requestId,author}=input;
  if(!caller)fail(403,'suggest_not_allowed');
  if(typeof anchor!=='string'||anchor.length>200)fail(400,'invalid_anchor');
  if(typeof version!=='string'||typeof sourceHash!=='string'||version.length!==64||sourceHash.length!==64)fail(400,'invalid_version');
  if(typeof proposedText!=='string'||proposedText.length>50000)fail(400,'invalid_text');
  if(typeof requestId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId))fail(400,'invalid_request_id');
  // Include every JSON field (including untrusted extras) in the immutable receipt.
  const payload=JSON.stringify(Object.keys(input).sort().map(k=>[k,input[k]]));
  const prior=db.prepare('SELECT payload,response FROM revision_receipts WHERE doc_id=? AND caller=? AND request_id=?').get(docId,caller,requestId);
  if(prior){if(prior.payload!==payload)fail(409,'request_id_conflict');return JSON.parse(prior.response)}
  const html=readSource(docId);if(html==null)fail(404,'doc_not_found');
  // Check source drift before resolving the old anchor, which may have vanished.
  if(hash(html)!==sourceHash)fail(409,'revision_stale');
  const current=state(docId,anchor,caller,html),s=current.snapshot;
  if(s.version!==version||s.sourceHash!==sourceHash)fail(409,'revision_stale',{snapshot:s});
  if(proposedText!==s.proposedText){
   let hunks;try{hunks=authoredDifferences(s.baseText,s.proposedText,proposedText,current.owned)}catch(e){if(e instanceof RangeError)fail(422,e.code==='DIFF_BUDGET'?'diff_budget':'invalid_revision');throw e}
   const ownedIds=new Set(current.owned.map(h=>h.row.id));
   for(const row of current.rows){
    if(row.kind!=='rewrite'||row.status!=='open'||ownedIds.has(row.id))continue;
    // Multi-block legacy records genuinely target the full affected paragraph.
    const loc=mutationLocation(row,s.baseText,s.sourceHash,anchor);
    if(loc&&hunks.some(h=>rangesConflict(h,loc)))fail(409,'range_overlap',{existingId:row.id});
   }
   // First pin exact unchanged hunks, then retain only a one-to-one overlap.
   const remaining=new Set(current.owned),matched=new Map();
   for(const h of hunks){const old=[...remaining].find(o=>o.start===h.start&&o.end===h.end&&o.old===h.old&&o.next===h.next);if(old){matched.set(h,old);remaining.delete(old)}}
   const unmatched=hunks.filter(h=>!matched.has(h));
   for(const h of unmatched){const candidates=[...remaining].filter(o=>rangesConflict(o,h));if(candidates.length===1&&unmatched.filter(n=>rangesConflict(candidates[0],n)).length===1)matched.set(h,candidates[0])}
   const retained=new Set([...matched.values()].map(o=>o.row.id));
   for(const old of current.owned)if(!retained.has(old.row.id))db.prepare("UPDATE suggestions SET status='withdrawn' WHERE id=?").run(old.row.id);
   const ts=new Date().toISOString();
   for(const h of hunks){
    const old=matched.get(h);if(old&&old.start===h.start&&old.end===h.end&&old.old===h.old&&old.next===h.next)continue;
    if(old){db.prepare('UPDATE suggestions SET quote=?,body=?,base_text=?,range_start=?,range_end=?,span_occ=-1,source_hash=? WHERE id=?').run(escape(h.old),escape(h.next),escape(s.baseText),h.start,h.end,s.sourceHash,old.row.id)}
    else{const id=randomUUID();addSuggestion(db,{id,doc_id:docId,anchor,kind:'rewrite',quote:escape(h.old),body:escape(h.next),base_text:escape(s.baseText),range_start:h.start,range_end:h.end,author:escape(String(author||'reviewer').slice(0,120)),created_at:ts,request_caller:caller});db.prepare('UPDATE suggestions SET source_hash=? WHERE id=?').run(s.sourceHash,id)}
   }
  }
  const response={ok:true,snapshot:state(docId,anchor,caller,html).snapshot};
  db.prepare('INSERT INTO revision_receipts(doc_id,caller,request_id,payload,response,created_at) VALUES(?,?,?,?,?,?)').run(docId,caller,requestId,payload,JSON.stringify(response),new Date().toISOString());
  return response;
 });
 // A source hash is a freshness hint, not proof that an unchanged unique
 // paragraph became invalid. Never search a similar paragraph or shift an
 // occurrence among duplicate paragraphs after source changes.
 function invalidReason(docId,row,html=readSource(docId)){
  if(row.kind!=='rewrite')return null;
  if(row.status==='stale')return '原引用或修订范围已失效，不能安全应用；正文未修改';
  if(html==null)return '原文稿已不存在，不能安全应用';
  const drift=!!row.source_hash&&row.source_hash!==hash(html);
  if(drift&&affectedAnchors(row).some(a=>!isSourceAnchor(a)))return '源文已变化，旧引用无法安全重验';
  if(drift){
   // Occurrence-addressed duplicate paragraphs cannot establish old identity.
   const leaves=facade(parse(html)),counts=new Map();
   for(const el of collectLeaves(leaves)){const n=normalizeText(el.textContent);if(n){const h=hash(n);counts.set(h,(counts.get(h)||0)+1)}}
   if(affectedAnchors(row).some(a=>a.includes('#')||(counts.get(a)||0)>1))return '源文已变化，重复段落身份无法安全确认';
  }
  try{validateLegacy(docId,{...row,source_hash:null},html)}catch(e){if(e instanceof RevisionError)return '原段落已删除、锚点失效或修订范围已变化；未改挂到其他位置';throw e}
  // Synthetic legacy anchors have no parsed source identity; retain their
  // original overlay/range checks, without treating client flags as authority.
  const overlay=getOverlay(db,docId);
  for(const anchor of affectedAnchors(row)){
   if(isSourceAnchor(anchor))continue;
   const base=plainText(overlay[anchor]?.text??row.base_text??'');
   if(!mutationLocation({...row,source_hash:null},base,null,anchor))return '原修订范围已变化，不能安全应用';
  }
  return null;
 }
 const decide=db.transaction((docId,sid,action)=>{
  const row=getSuggestion(db,sid);
  if(!row||row.doc_id!==docId)fail(404,'suggestion_not_found');
  if(action==='resolve-stale'&&row.resolved_stale)return {ok:true,suggestion:row,replayed:true};
  if(row.status!=='open'&&!(action==='resolve-stale'&&row.status==='stale'))fail(409,'already_resolved');
  const reason=invalidReason(docId,row);
  if(action==='resolve-stale'){
   if(row.kind!=='rewrite'||!reason)fail(409,'suggestion_not_stale');
   setSuggestionStatus(db,sid,'rejected');
   // Reuse the immutable continuous-revision history, not another schema or
   // lifecycle status. A rejected rewrite can never be reopened by comment API.
   db.prepare("INSERT INTO rewrite_history(suggestion_id,doc_id,operation,ts,old_json,new_json) VALUES(?,?,'RESOLVE_STALE',?,NULL,?)").run(sid,docId,new Date().toISOString(),JSON.stringify({reason}));
   return {ok:true,suggestion:getSuggestion(db,sid)};
  }
  if(reason){setSuggestionStatus(db,sid,'stale');return {error:'span_stale',overlay:getOverlay(db,docId),suggestion:{...getSuggestion(db,sid),invalid_reason:reason}}}
  const overlay=acceptSuggestion(db)(sid,row.body,new Date().toISOString());
  if(!overlay)return {error:'already_resolved'};
  if(overlay.stale)return {error:'span_stale',suggestion:getSuggestion(db,sid)};
  return {ok:true,overlay};
 });
 return {invalidReason,decide:(...args)=>decide.immediate(...args),validateLegacy,checkLegacyOverlap,snapshot:(...args)=>snapshot(...args),reconcile:(...args)=>reconcile.immediate(...args)};
}
