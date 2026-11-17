import {bind,date,t} from './i18n.js';
// Bounded pages; do not silently render a partial history as the full discussion.
export async function feedbackHistory(doc){
 const records=[],seen=new Set();let offset=0,snapshot='';
 for(let page=0;page<50;page++){
  const response=await fetch('/api/suggestions/'+encodeURIComponent(doc)+'?status=all&offset='+offset+'&snapshot='+encodeURIComponent(snapshot));
  if(!response.ok)throw Object.assign(new Error(t('review.loadCommentsFailed')+' ('+response.status+')'),{status:response.status});
  const data=await response.json();if(!Array.isArray(data.suggestions))throw Error('Invalid feedback response');
  for(const record of data.suggestions){if(seen.has(record.id))throw Error('History changed while loading; reload');seen.add(record.id);records.push(record);}
  if(data.complete!==false)return records;snapshot=data.snapshot||'';
  if(!Number.isSafeInteger(data.nextOffset)||data.nextOffset<=offset)throw Error('Incomplete feedback history');offset=data.nextOffset;
 }
 throw Error('History exceeds 10000 threads; use status filters in the CLI');
}
export async function installVersionNavigation({document:doc}){
 const details=document.createElement('details'),summary=document.createElement('summary');bind(summary,'agent.versions');details.append(summary);details.id='agent-versions';details.style.cssText='padding:16px;overflow-wrap:anywhere;max-height:45vh;overflow:auto';document.querySelector('.nav').append(details);
 const message=document.createElement('p');details.append(message);
 async function load(){
  try{
   const response=await fetch('/api/document-series/'+encodeURIComponent(doc));if(!response.ok)throw Error('HTTP '+response.status);const data=await response.json();message.remove();
   for(const version of data.versions){const p=document.createElement('p'),link=document.createElement('a');link.href='/viewer.html?doc='+encodeURIComponent(version.doc);link.textContent=date(version.created)+(version.doc===doc?' · ●':'');link.title=version.doc;p.append(link);details.append(p);}
  }catch(e){message.textContent=t('agent.unavailable')+' · '+e.message;const retry=document.createElement('button');retry.textContent=t('review.retryLocate');retry.onclick=()=>{retry.remove();load()};message.append(' ',retry);}
 }await load();
}
