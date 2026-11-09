import {reviewBridge as bridge} from './viewer.js';
import {reviewerName,setReviewerName} from './identity.js';
import {textOf,rangeAt,difference,locateRecord} from './review-ranges.js';
import {createStaticPreview} from './static-preview.js';
import {initPreview} from './preview-viewport.js';
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const root=$('#hs-doc-root'), docId=new URLSearchParams(location.search).get('doc')||decodeURIComponent(location.pathname.match(/^\/d\/([^/]+)/)?.[1]||'');
const esc=t=>String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decode=t=>{const e=document.createElement('textarea');e.innerHTML=String(t??'');return e.value};
let mode='read', records=[], filter='open', listStatus='all', listType='all', active=null, selected=null, replyTo=null, composing=false, draft=null, busy=false, refreshBusy=false, myName=reviewerName(false), overlaySignature='';
let clean=new Map(), locations=new Map(), reloading=false;
const editBuffers=new Map();
let staticPreview=null, frameSelection=null;
function staticMessage(m){
 if(state().interactive)return;
 if(m.type==='located'&&m.rect&&['left','top','width','height'].every(k=>Number.isFinite(m.rect[k])&&Math.abs(m.rect[k])<100000)){document.dispatchEvent(new CustomEvent('preview-reveal',{detail:{frame:staticPreview.frame,rect:m.rect}}));return}
 if(m.type==='selection'){
  if(!m.selection){frameSelection=null;if(!selectionPress&&$('#composer').hidden){selected=null;selectionUI(null)}return}
  const s=m.selection,c=clean.get(m.anchor),r=s.rect,grouped=getBlock(m.anchor)?.hasAttribute('data-hs-group');
  if(!c||typeof s.quote!=='string'||s.quote.length>100000||!Number.isInteger(s.rangeStart)||!Number.isInteger(s.rangeEnd)||s.rangeStart<0||s.rangeEnd<s.rangeStart||!grouped&&c.text.slice(s.rangeStart,s.rangeEnd)!==s.quote||!r||!['left','top','width','height'].every(k=>Number.isFinite(r[k])&&Math.abs(r[k])<100000))return;
  const frame=staticPreview.frame,box=frame.getBoundingClientRect(),sx=box.width/frame.offsetWidth,sy=box.height/frame.offsetHeight;
  frameSelection={anchor:m.anchor,baseText:c.text,quote:s.quote,rangeStart:s.rangeStart,rangeEnd:s.rangeEnd,rect:{left:box.left+(r.left+frame.clientLeft)*sx,top:box.top+(r.top+frame.clientTop)*sy}};
  if(grouped){delete frameSelection.rangeStart;delete frameSelection.rangeEnd}
  if(state().canSuggest&&!draft&&!composing){selected=frameSelection;selectionUI(selected)}
 }else if(m.type==='input'){
  const el=getBlock(m.anchor);if(!el||typeof m.text!=='string'||m.text.length>200000||el.contentEditable!=='true'||mode==='read'||reloading||busy)return;
  let blocked=false;beginInput({target:el,inputType:'insertText',preventDefault(){blocked=true}});if(blocked){staticPreview.sync();return}
  const d=difference(textOf(el),m.text),r=rangeAt(el,d.start,d.end,'[data-review-del],[data-review-point]');
  if(!r){staticPreview.sync();return}r.deleteContents();r.insertNode(document.createTextNode(d.next));handleInput({target:el});staticPreview.sync();
 }else if(m.type==='thread'&&typeof m.id==='string'&&m.id.length<256&&records.some(s=>s.id===m.id))openDiscussion(m.id);
 else if(m.type==='comment'&&state().canSuggest){const el=getBlock(m.anchor);selected={anchor:m.anchor,quote:el?.getAttribute('alt')||'非文本元素',baseText:''};showComposer()}
 else if(m.type==='key'&&draft){if(m.key==='Escape')cancelDraft();else if(['Enter','insertParagraph','insertLineBreak'].includes(m.key))submitDraft();else if(['z','Z','historyUndo','historyRedo'].includes(m.key))undoDraft(m.shift||m.key==='historyRedo');staticPreview.sync()}
}
function localEditing(){return !$('#composer').hidden||!!draft||composing||editTimers.size>0||editInflight>0||[...editBuffers.values()].some(b=>b.seq>b.saved)||mode==='edit'&&root.contains(document.activeElement)}
function status(text,kind='saved'){const e=$('#hs-status');e.className='saved '+kind;e.querySelector('.txt').textContent=text}
function toast(t){$('#toast').textContent=t;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,4000)}
async function api(path,body,method='POST'){
 const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await r.json().catch(()=>({}));if(!r.ok){const err=new Error(({span_stale:'原段落已改变，建议未应用',not_your_doc:'只有文稿所有者可以处理批注',edit_not_allowed:'无直接编辑权限',suggest_not_allowed:'当前链接不允许建议',rate_limited:'操作过快，请稍后重试'}[data.error]||data.error||'请求失败'));err.code=r.status;throw err}return data;
}
function state(){return bridge.state}
function getBlock(anchor){return state().anchorMap.get(anchor)||state().commentMap.get(anchor)}
function setView(next){
 clearSelection();
 if(draft){toast('请先提交或取消当前段落草稿');return}
 document.body.classList.toggle('list-view',next==='list');$('#annotation-list').hidden=next!=='list';
 $$('[data-view]').forEach(b=>{b.classList.toggle('selected',b.dataset.view===next);b.setAttribute('aria-pressed',String(b.dataset.view===next))});
 $('#nav-article').classList.toggle('active',next==='article');$('#nav-comments').classList.toggle('active',next==='list');if(next==='list'){closeDiscussion();renderList();window.scrollTo(0,0)}syncDiscussion()
}
function closeNav(){document.body.classList.remove('nav-open');$('#nav-shade').hidden=true;if(innerWidth<=1100)$('#nav-toggle').setAttribute('aria-expanded','false')}
function toggleNav(force){
 if(innerWidth>1100){document.body.classList.toggle('nav-collapsed',force===undefined?!document.body.classList.contains('nav-collapsed'):!force);$('#nav-toggle').setAttribute('aria-expanded',String(!document.body.classList.contains('nav-collapsed')))}
 else{const open=force??!document.body.classList.contains('nav-open');document.body.classList.toggle('nav-open',open);$('#nav-shade').hidden=!open;$('#nav-toggle').setAttribute('aria-expanded',String(open))}
 $('#nav-toggle').setAttribute('aria-label',$('#nav-toggle').getAttribute('aria-expanded')==='true'?'收起文稿导航':'展开文稿导航');
}
function discussionOpen(){return getComputedStyle($('#discussion')).display!=='none'}
function syncDiscussion(){const open=discussionOpen();$$('.show-discussion,.comment-toggle').forEach(b=>{b.setAttribute('aria-expanded',String(open));b.setAttribute('aria-controls','discussion');b.setAttribute('aria-label',open?'收起批注':'打开批注');b.classList.toggle('selected',open)})}
function toggleDiscussion(){if(draft)return toast('请先提交或取消草稿');if(discussionOpen())closeDiscussion();else openDiscussion()}
function closeDiscussion(){document.body.classList.remove('drawer-open');document.body.classList.add('drawer-closed');syncDiscussion()}
// Scroll only the discussion viewport, never its article/window ancestors.
function scrollThread(id){
 const card=$('#thread-'+CSS.escape(id)), viewport=$('#threads');if(!card)return;
 const box=card.getBoundingClientRect(), view=viewport.getBoundingClientRect();
 if(box.top<view.top||box.bottom>view.bottom)viewport.scrollTop+=box.top-view.top;
}
function openDiscussion(id){clearSelection();if(draft)return toast('请先提交或取消草稿');setView('article');if(id){active=id;filter='all';$$('[data-filter]').forEach(b=>b.classList.toggle('selected',b.dataset.filter===filter))}document.body.classList.remove('drawer-closed');document.body.classList.add('drawer-open');syncDiscussion();renderThreads();if(id)requestAnimationFrame(()=>scrollThread(id))}
function locate(id,open=true){
 const s=records.find(x=>x.id===id);if(!s)return;if(open)openDiscussion(id);else if(innerWidth<=1100)closeDiscussion();
 $$('.record-focus').forEach(n=>n.classList.remove('record-focus'));
 if(state().interactive){state().frame?.contentWindow?.postMessage({type:'flashComment',anchor:s.anchor},'*');return}
 if(staticPreview?.active){staticPreview.send({type:'locate',id,anchor:s.anchor});return}
 const loc=locations.get(id);if(loc?.stale){toast(loc.reason);return}
 const el=root.querySelector(`[data-thread="${CSS.escape(id)}"]`)||getBlock(s.anchor?.startsWith('m:')?s.anchor.slice(2).split(',')[0]:s.anchor);
 if(el){el.classList.add('record-focus');el.scrollIntoView({block:'center'});if(loc?.fallback)toast(loc.reason)}else toast('原段落已删除或无法定位；未改挂到其他位置');
}
function statusText(s){return ({open:'未处理',accepted:'已处理 · 已接受',rejected:s.kind==='comment'?'已处理 · 已解决':'已处理 · 已拒绝',stale:'已处理 · 锚点失效'}[s.status]||s.status)}
function typeText(s){return s.kind==='comment'?'评论':'修改建议'}
function quoteHtml(s){return s.kind==='rewrite'?`<del style="color:#92584e">${esc(decode(s.quote))||'（无删除）'}</del> → <span style="color:#285d48">${esc(decode(s.body))||'（删除此处）'}</span>`:esc(decode(s.quote))}
function renderList(){
 const matches=records.filter(t=>(listStatus==='all'||(listStatus==='open'?t.status==='open':t.status!=='open'))&&(listType==='all'||t.kind===(listType==='suggestion'?'rewrite':listType)));
 $('#list-summary').textContent=`显示 ${matches.length} 条 / 共 ${records.length} 条 · 未处理 ${records.filter(s=>s.status==='open').length} 条`;
 $('#list-records').innerHTML=matches.map(t=>`<button class="annotation-row" data-record="${esc(t.id)}"><span class="row-meta"><span class="avatar">${esc([...t.author||'访'][0])}</span><strong>${esc(t.author||'访客')}</strong><span class="row-type">${typeText(t)}</span><span class="status">${statusText(t)}</span></span><span class="row-quote">${esc(decode(t.quote))||'（插入位置）'}</span><span class="row-body">${t.kind==='comment'?esc(decode(t.body)):quoteHtml(t)}</span><span class="row-link">查看原文与讨论 ↗${t.replies?.length?' · '+t.replies.length+' 条回复':''}${locations.get(t.id)?.stale?' · 引用失效':''}</span></button>`).join('')||'<div class="empty">没有符合筛选条件的批注。</div>';
}
function renderThreads(){
 const items=records.filter(t=>filter==='all'||(filter==='done'?t.status!=='open':t.status==='open'));
 $('#threads').innerHTML=items.map(t=>`<section class="thread ${active===t.id?'active':''} ${t.status!=='open'?'resolved':''}" id="thread-${esc(t.id)}" data-card="${esc(t.id)}"><div class="thread-top"><span class="avatar">${esc([...t.author||'访'][0])}</span><strong>${esc(t.author||'访客')}</strong><span class="time">${esc(new Date(t.created_at).toLocaleDateString('zh-CN'))}</span></div><span class="thread-type">${t.kind==='rewrite'?'↗':'●'} ${typeText(t)}${t.status!=='open'?' · '+statusText(t):''}</span><div class="quote">${quoteHtml(t)}</div><p>${t.kind==='comment'?esc(decode(t.body)):t.status==='open'?'已在正文原位提出修改，等待所有者确认。':statusText(t)}</p>${locations.get(t.id)?.stale?`<p class="stale">${esc(locations.get(t.id).reason)}</p>`:''}${(t.replies||[]).map(r=>`<div class="reply"><b>${esc(r.author)}</b><br>${esc(decode(r.body))}</div>`).join('')}${t.kind==='rewrite'&&t.status==='open'&&state().isDocOwner?`<div class="thread-actions"><button class="accept" ${locations.get(t.id)?.stale?'disabled title="原引用已失效，不能接受"':''} data-accept="${esc(t.id)}">✓ 接受修改</button><button data-reject="${esc(t.id)}">拒绝</button></div>`:''}<div class="thread-footer"><button data-locate="${esc(t.id)}">↗ 定位原文</button><span>${state().canSuggest?`<button data-reply="${esc(t.id)}">回复</button>`:''}${t.kind==='comment'&&t.status==='open'&&state().isDocOwner?`<button data-resolve="${esc(t.id)}">解决 ✓</button>`:''}</span></div></section>`).join('')||'<div class="empty">暂时没有符合筛选条件的讨论。<br>选中文字即可添加一条批注。</div>';
}
function render(){const count=records.filter(t=>t.status==='open').length;$$('.total').forEach(n=>n.textContent=count);renderList();renderThreads()}
function captureClean(){clean=new Map();for(const [a,el] of state().anchorMap)clean.set(a,{html:el.innerHTML,text:bridge.readText(el)});overlaySignature=JSON.stringify(state().currentOverlay)}
function restoreClean(){for(const [a,s] of clean){const el=getBlock(a);if(el&&draft?.anchor!==a){el.innerHTML=s.html;delete el.dataset.reviewBlockThread}}}
function wrapRange(el,loc,s,kind){
 const r=rangeAt(el,loc.start,loc.end);if(!r)return false;
 const span=document.createElement(kind==='rewrite'?'del':'span');span.dataset.thread=s.id;
 if(kind==='rewrite'){span.dataset.reviewDel='';span.contentEditable='false'}else{span.dataset.reviewMark='';if(s.status!=='open')span.classList.add('done')}
 if(loc.start!==loc.end){span.append(r.extractContents());r.insertNode(span)}
 else{span.dataset.reviewPoint='';span.contentEditable='false';r.insertNode(span)}
 if(kind==='rewrite'){
  const ins=document.createElement('ins');ins.dataset.thread=s.id;ins.dataset.reviewIns='';ins.contentEditable='false';ins.textContent=decode(s.body);span.after(ins);
 }else if(s.kind==='comment'){
  const marker=document.createElement('button');marker.type='button';marker.className='marker'+(s.status!=='open'?' done':'');marker.dataset.thread=s.id;marker.dataset.reviewPoint='';marker.contentEditable='false';marker.textContent=String(records.indexOf(s)+1);marker.setAttribute('aria-label','打开此处批注 '+marker.textContent);span.after(marker);
 }
 return true;
}
function decorate(){
 clearSelection();if(state().interactive)return;restoreClean();locations=new Map();
 for(const s of records){
  if(s.anchor?.startsWith('m:')){const el=getBlock(s.anchor.slice(2).split(',')[0]);locations.set(s.id,el?{fallback:true,reason:'旧多段批注；定位首段'}:{stale:true,reason:'原段落无法定位'});continue}
  const el=getBlock(s.anchor), original=clean.get(s.anchor);
  if(!el){locations.set(s.id,{stale:true,reason:'原段落已删除或锚点失效，未改挂到其他位置'});continue}
  if(!original){locations.set(s.id,{fallback:true,reason:'非文本元素批注'});el.dataset.reviewBlockThread=s.id;continue}
  const loc=el.hasAttribute('data-hs-group')?{fallback:true,reason:'分组富文本批注；定位原文分组'}:locateRecord(s,original.text,decode);locations.set(s.id,loc);
  if(loc.stale||draft?.anchor===s.anchor)continue;
  if(loc.fallback){el.dataset.reviewBlockThread=s.id;continue}
  // Pending rewrites are handled after comments so offsets refer only to accepted text.
  if(s.kind==='rewrite'||mode==='edit')continue;
  wrapRange(el,loc,s,'comment');
 }
 for(const s of records.filter(t=>t.kind==='rewrite')){
  const loc=locations.get(s.id),el=getBlock(s.anchor);if(!loc||loc.stale||loc.fallback||draft?.anchor===s.anchor||!el||mode==='edit')continue;
  if(s.status==='open')wrapRange(el,loc,s,'rewrite');else wrapRange(el,loc,s,'comment');
 }
 applyMode();
}
async function refresh(reload=false){
 if(refreshBusy||localEditing())return;refreshBusy=true;
 try{
  if(reload){reloading=true;root.inert=true;await bridge.reload();await staticPreview?.reconnect();captureClean();editBuffers.clear();buildToc()}
  const r=await fetch(`/api/suggestions/${encodeURIComponent(docId)}?status=all`);
  if(r.status===403){records=[];$('#threads').innerHTML='<div class="empty">当前链接仅允许阅读，不展示批注记录。</div>';return}
  if(!r.ok)throw Error('批注加载失败');records=(await r.json()).suggestions||[];if(!localEditing()){decorate();render()}
 }catch(e){status(e.message,'error')}finally{refreshBusy=false;reloading=false;root.inert=false}
}
function applyMode(){
 const caps=state();bridge.setMode(caps.interactive?(mode==='read'?'use':mode):'view');
 $$('[data-mode]').forEach(b=>{const m=b.dataset.mode;b.disabled=(m==='edit'&&!caps.canEdit)||(m==='suggest'&&!caps.canSuggest);b.classList.toggle('selected',m===mode);b.setAttribute('aria-pressed',String(m===mode));if(b.disabled)b.title=m==='edit'?'此链接没有直接编辑权限':'此链接不允许建议'});
 if(!caps.interactive)for(const [a,el] of caps.anchorMap){const locked=records.some(s=>s.anchor===a&&s.status==='open'&&s.kind==='rewrite');const grouped=el.hasAttribute('data-hs-group');el.contentEditable=String((mode==='edit'&&caps.canEdit)||(mode==='suggest'&&caps.canSuggest&&!locked&&!grouped));if(grouped&&mode==='suggest')el.title='分组富文本仅支持批注；请在普通单段正文中提出原位修改'}
 staticPreview?.sync();
}
function changeMode(next){if(editTimers.size||editInflight||[...editBuffers.values()].some(b=>b.seq>b.saved))return toast('正文仍在保存，请稍后切换模式');if(draft)return toast('请先提交或取消当前草稿');if(next==='edit'&&!state().canEdit||next==='suggest'&&!state().canSuggest)return;mode=next;decorate();applyMode();clearSelection()}
function buildToc(){
 const title=root.querySelector('h1')?.textContent?.trim()||docId;$('#hs-docname').textContent=title;document.title=title+' · Marginroom';
 $('#toc').innerHTML='';root.querySelectorAll('h1,h2,h3').forEach((h,i)=>{const b=document.createElement('button');b.className='sub';b.textContent=h.textContent.trim();b.onclick=()=>{setView('article');closeNav();if(staticPreview?.active&&h.dataset.hsAnchor)staticPreview.send({type:'locate',anchor:h.dataset.hsAnchor,id:''});else h.scrollIntoView({block:'start'})};$('#toc').append(b)});
}
function selectionInfo(){
 if(staticPreview?.active)return frameSelection;
 const sel=getSelection();if(!sel?.rangeCount||sel.isCollapsed)return null;
 const r=sel.getRangeAt(0),node=r.startContainer.nodeType===1?r.startContainer:r.startContainer.parentElement,el=node.closest('[data-hs-anchor]');
 if(!el||!root.contains(el)||!el.contains(r.endContainer))return null;
 if(el.hasAttribute('data-hs-group'))return {anchor:el.dataset.hsAnchor,baseText:bridge.readText(el),quote:r.toString(),rect:r.getBoundingClientRect()};
 if(r.cloneContents().querySelector('[data-review-ins],[data-review-del]')||node.closest('[data-review-ins],[data-review-del]'))return null;
 const pre=document.createRange();pre.selectNodeContents(el);pre.setEnd(r.startContainer,r.startOffset);
 const start=textOf(pre.cloneContents(),'[data-review-ins],[data-review-point]'),quote=textOf(r.cloneContents());if(!quote.trim())return null;
 return {anchor:el.dataset.hsAnchor,baseText:clean.get(el.dataset.hsAnchor)?.text??el.textContent,quote,rangeStart:start.length,rangeEnd:start.length+quote.length,rect:r.getBoundingClientRect()};
}
// Store quote + logical offsets, never a live Range that focus or decoration can mutate.
let selectionPress=null, selectionPressTimer;
const phone=matchMedia('(max-width:600px)');
function selectionUI(s){
 const available=!!s&&$('#composer').hidden&&!draft&&!composing&&!document.body.classList.contains('list-view');
 $('#mobile-selection').hidden=!(available&&phone.matches);
 $('.dock').classList.toggle('has-selection',available&&phone.matches);
 $('#selection-action').hidden=!(available&&!phone.matches);
 if(available&&!phone.matches){$('#selection-action').style.left=Math.min(innerWidth-145,Math.max(10,s.rect.left))+'px';$('#selection-action').style.top=Math.min(innerHeight-120,Math.max(70,s.rect.top-49))+'px'}
}
function clearSelection(remove=false){clearTimeout(selectionPressTimer);selectionPress=null;selected=null;frameSelection=null;selectionUI(null);if(remove){getSelection()?.removeAllRanges();staticPreview?.send({type:'clear-selection'})}}
function captureSelection(){
 if(selectionPress||!$('#composer').hidden)return;
 if(composing||draft||reloading||!state().canSuggest||state().interactive){clearSelection();return}
 selected=selectionInfo();selectionUI(selected);
}
function armSelection(e){
 const s=selectionInfo()||selected;if(!s)return;
 selectionPress={...s};clearTimeout(captureSelection.timer);
 // Prevent focus only on our action, never on the article or native selection UI.
 e.preventDefault();clearTimeout(selectionPressTimer);
 selectionPressTimer=setTimeout(()=>{selectionPress=null;captureSelection()},1500);
}
function showComposer(id){
 if(!$('#composer').hidden||draft||busy)return;
 if(!id){selected=selectionPress||selectionInfo()||selected;if(!selected||(!state().interactive&&selected.rangeStart!=null&&!getBlock(selected.anchor)))return}
 clearTimeout(selectionPressTimer);selectionPress=null;replyTo=id||null;showComposer.requestId=crypto.randomUUID?.()||'r'+Date.now();
 selectionUI(null);$('#composer-title').textContent=id?'回复讨论':'添加批注';$('#selected-quote').textContent=id?decode(records.find(s=>s.id===id)?.quote):selected.quote;$('#comment-body').value='';$('#send-comment').textContent=id?'回复':'添加批注';$('#composer').hidden=false;$('#shade').hidden=false;$('#comment-body').focus({preventScroll:true});$('#comment-body').scrollTop=0;
}
function closeComposer(){if(busy)return;$('#composer').hidden=true;$('#shade').hidden=true;replyTo=null;clearSelection(true)}
async function sendComment(){
 const body=$('#comment-body').value.trim();if(!body||busy)return;busy=true;$('#send-comment').disabled=true;
 try{let id=replyTo;
  if(id)await api(`/api/suggest/${encodeURIComponent(docId)}/${encodeURIComponent(id)}/replies`,{body,author:myName,requestId:showComposer.requestId});
  else{const res=await api(`/api/suggest/${encodeURIComponent(docId)}`,{...selected,rect:undefined,body,kind:'comment',author:myName,requestId:selected.requestId||(selected.requestId=crypto.randomUUID?.()||'c'+Date.now())});id=res.suggestion.id}
  busy=false;closeComposer();await refresh();openDiscussion(id);status('批注已保存');getSelection()?.removeAllRanges();
 }catch(e){toast(e.message);status('批注未提交，请重试','error')}finally{busy=false;$('#send-comment').disabled=false}
}
function caretOffset(el){const s=getSelection();if(!s?.rangeCount||!el.contains(s.focusNode))return null;const r=document.createRange();r.selectNodeContents(el);r.setEnd(s.focusNode,s.focusOffset);return textOf(r.cloneContents()).length}
function placeCaret(el,n){const r=rangeAt(el,n,n,'[data-review-del],[data-review-point]');if(r){const s=getSelection();s.removeAllRanges();s.addRange(r)}}
function paintDraft(caret){
 if(!draft)return;const d=difference(draft.base,draft.next),el=draft.el;el.innerHTML=draft.html;
 const r=rangeAt(el,d.start,d.end);if(r){const f=document.createDocumentFragment();if(d.old){const del=document.createElement('del');del.dataset.reviewDel='';del.contentEditable='false';del.append(r.extractContents());f.append(del)}else r.deleteContents();if(d.next){const ins=document.createElement('ins');ins.dataset.reviewIns='';ins.textContent=d.next;f.append(ins)}r.insertNode(f)}
 if(caret!=null)placeCaret(el,caret);$('#draft-actions').hidden=false;status('建议草稿 · 尚未提交','dirty');
 staticPreview?.sync();
}
function cancelDraft(){if(!draft||busy)return;draft.el.innerHTML=draft.html;draft=null;$('#draft-actions').hidden=true;decorate();status('已取消草稿')}
async function submitDraft(){
 if(!draft||busy||composing)return;const current=draft;if(current.base===current.next){cancelDraft();return}
 busy=true;current.el.contentEditable='false';$('#submit-draft').disabled=true;const d=difference(current.base,current.next);
 try{
  const res=await api(`/api/suggest/${encodeURIComponent(docId)}`,{anchor:current.anchor,quote:d.old,body:d.next,kind:'rewrite',author:myName,baseText:current.base,rangeStart:d.start,rangeEnd:d.end,requestId:current.requestId});
  draft=null;$('#draft-actions').hidden=true;await refresh();active=res.suggestion.id;render();status('建议已保存，等待确认');toast('建议已保存；继续修改此段前，请先处理该段建议');
 }catch(e){current.el.contentEditable='true';toast(e.message);status('草稿未提交，可重试或取消','error')}finally{busy=false;$('#submit-draft').disabled=false}
}
function beginInput(e){
 if(reloading){e.preventDefault();return}
 if(mode==='read'||state().interactive)return;
 const el=e.target.closest?.('[data-hs-anchor]');if(!el)return;
 const sel=getSelection();if(sel?.rangeCount){const r=sel.getRangeAt(0);if(!el.contains(r.startContainer)||!el.contains(r.endContainer)){e.preventDefault();toast('原位修改限单个段落；跨段请选择分别处理');return}}
 if(mode==='suggest'){
  if(['insertParagraph','insertLineBreak'].includes(e.inputType)){e.preventDefault();submitDraft();return}
  if(draft&&draft.el!==el){e.preventDefault();toast('请先提交或取消当前段落草稿');return}
  if(!draft){const a=el.dataset.hsAnchor,c=clean.get(a);if(!c)return;draft={el,anchor:a,html:c.html,base:c.text,next:c.text,undo:[c.text],redo:[],requestId:crypto.randomUUID?.()||'s'+Date.now()}}
  if(e.inputType==='historyUndo'||e.inputType==='historyRedo'){e.preventDefault();undoDraft(e.inputType==='historyRedo')}
 }
}
function handleInput(e){
 const el=e.target.closest?.('[data-hs-anchor]');if(!el||composing||state().interactive)return;
 if(mode==='suggest'&&draft?.el===el){const caret=caretOffset(el);draft.next=textOf(el);if(draft.undo.at(-1)!==draft.next)draft.undo.push(draft.next);draft.redo=[];paintDraft(caret)}
 else if(mode==='edit'&&state().canEdit){queueEdit(el)}
}
function undoDraft(redo=false){if(!draft)return;const d=draft;if(redo){if(d.redo.length)d.undo.push(d.redo.pop())}else if(d.undo.length>1)d.redo.push(d.undo.pop());d.next=d.undo.at(-1);paintDraft(d.next.length)}
const editTimers=new Map();let editInflight=0;
function queueEdit(el){
 const a=el.dataset.hsAnchor, prior=editBuffers.get(a)||{seq:0,saved:0,saving:false};
 prior.seq++;prior.text=el.hasAttribute('data-hs-group')?bridge.readText(el):textOf(el);prior.html=el.innerHTML;editBuffers.set(a,prior);
 clean.set(a,{html:prior.html,text:prior.text});
 clearTimeout(editTimers.get(a));editTimers.set(a,setTimeout(()=>saveEdit(el),700));status('正文正在编辑…','dirty');
}
async function saveEdit(el){
 const a=el.dataset.hsAnchor;clearTimeout(editTimers.get(a));editTimers.delete(a);const buffer=editBuffers.get(a);
 if(!buffer||buffer.saving||buffer.saved===buffer.seq)return;
 const seq=buffer.seq,text=buffer.text;buffer.saving=true;editInflight++;
 try{const data=await api(`/api/edit/${encodeURIComponent(docId)}`,{anchor:a,text});buffer.saved=seq;overlaySignature=JSON.stringify(data.overlay);status(buffer.seq===seq?'正文已保存':'正在保存后续修改…',buffer.seq===seq?'saved':'dirty')}
 catch(e){status('正文未保存 · '+e.message+'（重新输入或离开段落可重试）','error');toast(e.message)}
 finally{buffer.saving=false;editInflight--;if(buffer.seq>seq)saveEdit(el)}
}
async function decide(id,action){
 if(editTimers.size||editInflight||[...editBuffers.values()].some(b=>b.seq>b.saved))return toast('请先等待正文保存');
 if(action==='accept'&&locations.get(id)?.stale)return toast('原引用失效，不能接受');
 if(busy||draft)return;busy=true;
 try{await api(`/api/suggest/${encodeURIComponent(docId)}/${encodeURIComponent(id)}/${action}`,undefined);await refresh(true);status(action==='accept'?'已接受修改':'已处理批注')}
 catch(e){toast(e.message);await refresh(e.code===409);status(e.message,e.code===409?'saved':'error')}finally{busy=false}
}
function pop(html){$('#popover').innerHTML=html;$('#popover').hidden=false}
function paintName(){$$('.my-avatar').forEach(n=>n.textContent=[...myName][0]);$('.person-name').textContent=myName}
function nameMenu(){pop(`<h3>你的审稿姓名</h3><p>姓名保存在当前浏览器，用于新批注。</p><input id="review-name" aria-label="审稿姓名" maxlength="80" value="${esc(myName)}"><button id="save-name" class="primary" style="margin-top:12px">确认</button>`);$('#save-name').onclick=()=>{myName=setReviewerName($('#review-name').value);paintName();$('#popover').hidden=true}}
function shareMenu(){const url=new URL(location.href);url.searchParams.delete('key');pop(`<h3>分享文稿</h3><input aria-label="公开分享链接" readonly value="${esc(url.href)}"><button id="copy-link" class="primary" style="margin-top:12px">复制链接</button>${state().isDocOwner?`<label>持有链接的人可以<select id="access-level"><option value="view">仅阅读</option><option value="suggest">阅读与建议</option><option value="edit">直接编辑</option></select></label>`:''}<p id="share-note">${state().canEdit?'此链接可编辑或当前身份是所有者。':state().canSuggest?'当前身份可以建议，不能直接编辑。':'当前链接仅阅读。'}</p>`);$('#copy-link').onclick=async()=>{try{await navigator.clipboard.writeText(url.href);toast('链接已复制')}catch{$('#popover input').select();toast('请使用系统复制')}};if($('#access-level')){fetch(`/api/doc/${encodeURIComponent(docId)}`).then(r=>r.json()).then(d=>{$('#access-level')&&($('#access-level').value=d.access)});$('#access-level').onchange=async e=>{try{await api(`/api/access/${encodeURIComponent(docId)}`,{level:e.target.value},'PUT');await refresh(true);toast('链接权限已更新')}catch(err){toast(err.message)}}}}
async function showHistory(){
 $('#popover').hidden=true;const panel=$('#hs-versions');panel.classList.add('open');panel.innerHTML='<button id="close-history" style="float:right">×</button><h3>版本历史</h3><div id="history-records">正在加载…</div>';$('#close-history').onclick=()=>panel.classList.remove('open');
 try{const data=await fetch(`/api/versions/${encodeURIComponent(docId)}`).then(r=>r.json());$('#history-records').innerHTML=(data.versions||[]).map(v=>`<div class="thread"><p>${esc(new Date(v.ts).toLocaleString('zh-CN'))}</p><p>${esc(v.label||'正文编辑')}</p><button data-preview-version="${v.id}">查看版本内容</button>${state().isDocOwner?`<button data-restore-version="${v.id}">恢复此版本</button>`:''}<pre id="version-${v.id}" style="white-space:pre-wrap;font-size:12px"></pre></div>`).join('')||'<p>暂无版本记录。</p>'}catch{$('#history-records').textContent='历史加载失败，请重试'}
}
async function poll(){
 if(localEditing()||selectionPress||selectionInfo()||busy||composing||editTimers.size||editInflight||root.contains(document.activeElement)&&['edit','suggest'].includes(mode))return;
 try{const r=await fetch(`/api/doc/${encodeURIComponent(docId)}`);if(!r.ok)return;const d=await r.json();if(localEditing()||root.contains(document.activeElement)&&mode==='suggest')return;const changed=JSON.stringify(d.overlay||{})!==overlaySignature||d.canEdit!==state().canEdit||d.canSuggest!==state().canSuggest;await refresh(changed)}catch{}
}
async function main(){
 // Standing help belongs in the existing help menu, not the discussion viewport.
 $('.discussion>.discussion-note')?.remove();
 // Measure the safe-area-aware dock so the sheet never reserves a guessed footer.
 // Reserve the measured warning while it occupies space above the workspace.
 const warning=$('#hs-warn');
 const syncNavInset=()=>document.documentElement.style.setProperty('--hs-nav-inset',Math.max(0,warning.getBoundingClientRect().bottom-$('.topbar').getBoundingClientRect().bottom)+'px');
 let navFrame=0;window.addEventListener('scroll',()=>{if(!navFrame)navFrame=requestAnimationFrame(()=>{navFrame=0;syncNavInset()})},{passive:true});
 const topbar=$('.topbar');
 const syncHeader=()=>{document.documentElement.style.setProperty('--hs-bar-h',topbar.getBoundingClientRect().height+'px');syncNavInset()};
 new ResizeObserver(syncHeader).observe(topbar);
 new ResizeObserver(syncNavInset).observe(warning);syncHeader();
 const syncSelectionViewport=()=>document.documentElement.style.setProperty('--hs-vv-top',(window.visualViewport?.offsetTop||0)+'px');
 window.visualViewport?.addEventListener('resize',syncSelectionViewport);window.visualViewport?.addEventListener('scroll',syncSelectionViewport);syncSelectionViewport();
 const dock=$('.dock');
 const syncDock=()=>document.documentElement.style.setProperty('--hs-dock-h',dock.getBoundingClientRect().height+'px');
 new ResizeObserver(syncDock).observe(dock);syncDock();
 if(!docId){root.textContent='请选择一份文稿。';return}
 try{if(!await bridge.init(docId))return;captureClean();buildToc();paintName();applyMode();await refresh();staticPreview=state().interactive?null:createStaticPreview({docId,bridge,root,onMessage:staticMessage,getMode:()=>mode});initPreview({docId,bridge,staticPreview});status('已连接 · 数据已同步')}
 catch(e){status('加载失败：'+e.message,'error');return}
 $('#nav-toggle').onclick=()=>toggleNav();$('#nav-close').onclick=()=>{toggleNav(false);closeNav()};$('#nav-shade').onclick=closeNav;$('#nav-article').onclick=()=>{setView('article');closeNav();closeDiscussion()};$('#nav-comments').onclick=()=>{closeNav();setView('list')};
 $$('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));$$('[data-mode]').forEach(b=>b.onclick=()=>changeMode(b.dataset.mode));$$('.show-discussion,.comment-toggle').forEach(b=>b.onclick=toggleDiscussion);$('.close-drawer').onclick=closeDiscussion;
 $$('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;$$('[data-filter]').forEach(x=>x.classList.toggle('selected',x===b));renderThreads()});
 $$('[data-status]').forEach(b=>b.onclick=()=>{listStatus=b.dataset.status;$$('[data-status]').forEach(x=>x.classList.toggle('selected',x===b));renderList()});
 $$('[data-type]').forEach(b=>b.onclick=()=>{listType=b.dataset.type;$$('[data-type]').forEach(x=>x.classList.toggle('selected',x===b));renderList()});
 $('#list-records').onclick=e=>{const id=e.target.closest('[data-record]')?.dataset.record;if(id)locate(id)};
 $('#threads').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.accept)decide(b.dataset.accept,'accept');if(b.dataset.reject)decide(b.dataset.reject,'reject');if(b.dataset.resolve)decide(b.dataset.resolve,'reject');if(b.dataset.locate)locate(b.dataset.locate,false);if(b.dataset.reply)showComposer(b.dataset.reply)};
 $('#article').addEventListener('click',e=>{const el=e.target.closest('[data-thread],[data-review-block-thread]');if(el&&(mode==='read'||el.contentEditable==='false')){openDiscussion(el.dataset.thread||el.dataset.reviewBlockThread);return}const image=e.target.closest('[data-hs-comment-anchor]');if(image&&state().canSuggest){selected={anchor:image.dataset.hsCommentAnchor,quote:image.getAttribute('alt')||'非文本元素',baseText:''};showComposer();return}
  // Only dismiss existing discussions. Selection, editing and composer drafts
  // keep their current cancellation semantics; never consume the article tap.
  if(innerWidth<=1100&&mode==='read'&&!localEditing()&&$('#composer').hidden&&getSelection()?.isCollapsed&&!e.target.closest('a,button,input,textarea,select,[contenteditable="true"]'))closeDiscussion();
 });
 document.addEventListener('review-frame-comment',e=>{if(!state().canSuggest)return;selected={anchor:e.detail.anchor,quote:e.detail.snippet||'交互文稿元素',baseText:''};showComposer()});
 document.addEventListener('review-frame-missing',e=>{for(const s of records)if(s.anchor===e.detail.anchor)locations.set(s.id,{stale:true,reason:'交互元素已变化或不存在，无法安全定位'});render()});
 document.addEventListener('selectionchange',()=>{clearTimeout(captureSelection.timer);captureSelection.timer=setTimeout(captureSelection,120)});
 document.addEventListener('preview-geometry',()=>{if(staticPreview?.active)staticPreview.send({type:'measure-selection'})});
 for(const button of [$('#selection-action'),$('#mobile-add-comment')]){button.onpointerdown=armSelection;button.onpointercancel=()=>{selectionPress=null;captureSelection()};button.onclick=()=>showComposer()}
 $('#cancel-selection').onclick=()=>clearSelection(true);$('#close-composer').onclick=closeComposer;phone.addEventListener('change',captureSelection);$('#cancel-comment').onclick=closeComposer;$('#shade').onclick=closeComposer;$('#send-comment').onclick=sendComment;
 root.addEventListener('beforeinput',beginInput);root.addEventListener('input',handleInput);root.addEventListener('compositionstart',e=>{beginInput(e);composing=true});root.addEventListener('compositionend',e=>{composing=false;handleInput(e)});
 root.addEventListener('paste',e=>{if(mode==='read'||state().interactive||reloading)return;e.preventDefault();const text=e.clipboardData.getData('text/plain');if(/[\r\n]/.test(text)){toast('原位修改限单段，请分段粘贴');return}let blocked=false;beginInput({target:e.target,inputType:'insertText',preventDefault(){blocked=true}});if(blocked)return;document.execCommand('insertText',false,text);handleInput(e)});
 // In edit mode decorate() already restores accepted HTML; never reset a live edit buffer on refocus.
 root.addEventListener('focusout',e=>{const el=e.target.closest('[data-hs-anchor]'),b=el&&editBuffers.get(el.dataset.hsAnchor);if(mode==='edit'&&el&&b&&b.seq>b.saved)saveEdit(el)});
 $('#submit-draft').onclick=submitDraft;$('#cancel-draft').onclick=cancelDraft;
 $('#name-btn').onclick=nameMenu;$('#share-btn').onclick=shareMenu;$('#more-btn').onclick=()=>{pop('<h3>文稿选项</h3><button id="history-menu">版本历史</button><button id="export-menu">导出已接受的 HTML</button><button id="help-menu">审稿操作说明</button>');$('#history-menu').onclick=showHistory;$('#export-menu').onclick=async()=>{if(draft||editTimers.size||editInflight)return toast('请先提交草稿并等待正文保存');$('#popover').hidden=true;await bridge.exportHtml()};$('#help-menu').onclick=()=>{toast('建议模式在单个普通段落内原位输入；Ctrl/⌘+Enter 或提交按钮保存，Esc取消草稿。已提交建议用接受/拒绝处理，跨段及分组富文本仅支持评论。');$('#popover').hidden=true}};
 $('#hs-versions').onclick=async e=>{const b=e.target.closest('button');if(b?.dataset.previewVersion){const r=await fetch(`/api/version/${encodeURIComponent(docId)}/${b.dataset.previewVersion}`).then(r=>r.json());$('#version-'+b.dataset.previewVersion).textContent=JSON.stringify(r.overlay,null,2)}if(b?.dataset.restoreVersion){if(draft||!confirm('恢复此版本？当前正文会保存为可追溯的历史。'))return;try{await api(`/api/restore/${encodeURIComponent(docId)}`,{versionId:Number(b.dataset.restoreVersion)});await refresh(true);showHistory()}catch(err){toast(err.message)}}};
 document.addEventListener('pointerdown',e=>{if(!e.target.closest('#popover,#name-btn,#share-btn,#more-btn'))$('#popover').hidden=true});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(draft)cancelDraft();else{closeComposer();closeDiscussion();closeNav();$('#popover').hidden=true;$('#hs-versions').classList.remove('open')}}if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&draft){e.preventDefault();submitDraft()}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&draft){e.preventDefault();undoDraft(e.shiftKey)}});
 window.addEventListener('beforeunload',e=>{if(draft||editTimers.size||editInflight||[...editBuffers.values()].some(b=>b.seq>b.saved)){e.preventDefault();e.returnValue='尚有未提交修改'}});
 syncDiscussion();matchMedia('(max-width:1100px)').addEventListener('change',syncDiscussion);
 if(innerWidth<=1100)$('#nav-toggle').setAttribute('aria-expanded','false');setInterval(poll,5000);
}
main();
