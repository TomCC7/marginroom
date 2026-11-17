import {bind,date,languageSelect,t} from './i18n.js';
export async function installVersionNavigation({document:doc,locate}){
 const response=await fetch('/api/document-series/'+encodeURIComponent(doc));if(!response.ok)return;const data=await response.json();
 const details=document.createElement('details'),summary=document.createElement('summary');bind(summary,'agent.versions');details.append(summary);details.id='agent-versions';details.style.cssText='padding:16px;overflow-wrap:anywhere;max-height:45vh;overflow:auto';
 const select=document.createElement('select');select.style.maxWidth='100%';bind(select,'agent.versions',{},'aria-label');
 for(const version of data.versions){const option=document.createElement('option');option.value=version.doc;option.textContent=date(version.created)+(version.doc===doc?' · ●':'');select.append(option);}details.append(select);
 const link=document.createElement('a');link.style.display='block';bind(link,'agent.versions');details.append(link);
 const list=document.createElement('div');details.append(list);document.querySelector('.nav').append(details);
 async function show(){link.href='/viewer.html?doc='+encodeURIComponent(select.value);list.replaceChildren();if(select.value===doc)return;
  const response=await fetch('/api/suggestions/'+encodeURIComponent(select.value)+'?status=all');if(!response.ok)return;
  for(const record of (await response.json()).suggestions){const p=document.createElement('p'),quote=document.createElement('blockquote'),button=document.createElement('button'),status=document.createElement('p');quote.textContent=record.quote;bind(button,'agent.locate');p.append(quote,button,status);list.append(p);
   button.onclick=async()=>{button.disabled=true;try{const response=await fetch('/api/versions-locate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({record:record.id,target:doc})});if(!response.ok)throw new Error();const result=await response.json();bind(status,'agent.'+result.status);status.title=result.reason;if(result.status==='located')locate(result.anchor);}catch{bind(status,'agent.unavailable');}finally{button.disabled=false;}};
  }
 }select.onchange=show;select.value=doc;await show();
}
