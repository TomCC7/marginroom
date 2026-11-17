// Read projection only. No inherited record or original locator is persisted/rewritten.
export const HISTORY_DEPTH = 128;
export function ancestry(db,doc,allowed){
 const rows=db.prepare(`WITH RECURSIVE chain(doc,previous,series,created,depth,path) AS (
 SELECT doc,previous,series,created,0,','||doc||',' FROM imported_documents WHERE doc=?
 UNION ALL SELECT p.doc,p.previous,p.series,p.created,c.depth+1,c.path||p.doc||','
 FROM imported_documents p JOIN chain c ON p.doc=c.previous AND p.series=c.series
 WHERE c.depth<? AND instr(c.path,','||p.doc||',')=0)
 SELECT doc,previous,series,created,depth FROM chain ORDER BY depth`).all(doc,HISTORY_DEPTH);
 if(rows.length>HISTORY_DEPTH)throw Object.assign(new Error('history_depth_limit'),{status:422});
 const visible=[];for(const row of rows){if(!allowed(row.doc))break;visible.push(row);}
 return visible;
}
export function feedbackPage(db,ids,status,{offset=0,limit=200}={}){
 if(!ids.length)return {rows:[],total:0};
 const slots=ids.map(()=>'?').join(','),where=`doc_id IN (${slots})`+(status==='all'?'':' AND status=?'),params=[...ids,...(status==='all'?[]:[status])];
 const total=db.prepare(`SELECT count(*) n FROM suggestions WHERE ${where}`).get(...params).n;
 // Oldest ancestor first, then creation time and stable id; independent of list recursion.
 const order='CASE doc_id '+ids.map((_,i)=>`WHEN ? THEN ${i}`).join(' ')+' END, created_at, id';
 const cols='id,doc_id,anchor,quote,body,kind,status,author,created_at,span_occ,base_text,range_start,range_end,request_id,source_hash';
 const rows=db.prepare(`SELECT ${cols} FROM suggestions WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params,...ids,limit,offset);
 if(rows.length){
  const inRows=rows.map(()=>'?').join(','),keys=rows.map(r=>r.id);
  const replies=db.prepare(`SELECT id,parent_id,author,body,created_at FROM suggestion_replies WHERE parent_id IN (${inRows}) ORDER BY created_at,rowid LIMIT 10001`).all(...keys);
  if(replies.length>10000)throw Object.assign(new Error('history_reply_limit'),{status:413});
  const events=db.prepare(`SELECT suggestion_id,new_json FROM rewrite_history WHERE suggestion_id IN (${inRows}) AND operation='RESOLVE_STALE' ORDER BY id`).all(...keys);
  const replyMap=new Map(),resolved=new Map(events.map(e=>[e.suggestion_id,JSON.parse(e.new_json).reason]));
  for(const reply of replies){if(!replyMap.has(reply.parent_id))replyMap.set(reply.parent_id,[]);replyMap.get(reply.parent_id).push(reply);}
  for(const row of rows){row.replies=replyMap.get(row.id)||[];if(resolved.has(row.id)){row.resolved_stale=true;row.stale_reason=resolved.get(row.id);}}
 }
 return {rows,total};
}
