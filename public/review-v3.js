import {t as tr,locale,bind,bindShell,onLocaleChange,languageSelect,date,number} from './i18n.js';
import {icon} from './icons.js';
import {elementReview} from './element-review.js';
import {sha256hex} from './anchoring.js';
import {reviewBridge as bridge} from './viewer.js';
import {reviewerName,setReviewerName} from './identity.js';
import {installVersionNavigation} from './version-navigation.js';
import {textOf,rangeAt,difference,locateRecord,singleBlockRange} from './review-ranges.js';
import {logicalText,logicalSelection} from './logical-text.js';
import {createStaticPreview} from './static-preview.js';
import {initPreview} from './preview-viewport.js';
import {inlineDraftController,inlineDraftCSS} from './inline-draft.js';
import {rangesConflict} from './range-patches.js';
import {annotationAffordances} from './annotation-affordances.js';
import {rememberDoc} from './entry-history.js';
import {initReading} from './entry-reading.js';
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const root=$('#hs-doc-root'), docId=new URLSearchParams(location.search).get('doc')||decodeURIComponent(location.pathname.match(/^\/d\/([^/]+)/)?.[1]||'');
const esc=t=>String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decode=t=>{const e=document.createElement('textarea');e.innerHTML=String(t??'');return e.value};
let mode='read', records=[], filter='open', listStatus='all', listType='all', active=null, selected=null, replyTo=null, composing=false, draft=null, busy=false, refreshBusy=false, myName=reviewerName(false), overlaySignature='';
let clean=new Map(), locations=new Map(), reloading=false;
const editBuffers=new Map(), pendingComments=new Set();let commentVersion=0;
let staticPreview=null, reading=null, frameSelection=null, picker=null, composeKind='comment';
function pickTarget(t,frame=null){if(mode!=='suggest'||!state().canSuggest||!$('#composer').hidden||draft)return;let rect=t.rect;if(frame&&rect){const b=frame.getBoundingClientRect(),sx=b.width/frame.offsetWidth,sy=b.height/frame.offsetHeight;rect={left:b.left+rect.left*sx,top:b.top+rect.top*sy}}selected={anchor:t.anchor,quote:t.quote||t.snippet,baseText:t.baseText||'',rangeStart:t.rangeStart,rangeEnd:t.rangeEnd,element:!t.isText,textAnchor:t.textAnchor,tag:t.tag,context:t.context,parent:t.parent,rect};selectionUI(selected)}
function navigateTarget(direction){if(direction!=='parent'||!$('#composer').hidden||draft)return;if(state().interactive)state().frame?.contentWindow.postMessage({type:'targetNavigate',direction},'*');else if(staticPreview?.active)staticPreview.send({type:'targetNavigate',direction});else picker?.navigate(direction)}
function elementScope(s){
 if(!s?.element||state().interactive||!s.textAnchor)return null;
 const el=getBlock(s.textAnchor),c=clean.get(s.textAnchor);
 // Exact canonical single text unit only, never a container's descendant.
 if(!el||!c||!c.text.trim()||el.hasAttribute('data-hs-group'))return null;
 const textLeaf=el.localName==='div'&&!new DOMParser().parseFromString(c.html,'text/html').body.children.length;
 if(!textLeaf&&!el.matches('p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,figcaption,dt,dd,caption,td,th'))return null;
 return {...s,element:false,anchor:s.textAnchor,baseText:c.text,quote:c.text,rangeStart:0,rangeEnd:c.text.length};
}
function rewriteReason(s){
 if(!state().canSuggest)return tr('review.noSuggest');
 if(state().interactive)return tr('review.interactiveOnly');
 if(!s||s.element||!Number.isInteger(s.rangeStart))return tr('review.singleParagraph');
 const c=clean.get(s.anchor),el=getBlock(s.anchor);if(!c||!el||el.hasAttribute('data-hs-group'))return tr('review.groupOnly');
 const doc=new DOMParser().parseFromString(c.html,'text/html');
 if(doc.body.querySelector('br,img,svg,math,.katex,input,textarea,select,button,table,ul,ol,li,iframe,[contenteditable]'))return tr('review.structureOnly');
 if(c.text!==s.baseText||c.text.slice(s.rangeStart,s.rangeEnd)!==s.quote)return tr('review.sourceMoved');
 // Pending changes are reconciled by the server against actual changed hunks,
 // never against this whole editable scope.
 return null;
}
function rewriteAllowed(s){return !rewriteReason(s)}
const inlineStyle=document.createElement('style');inlineStyle.textContent=inlineDraftCSS;document.head.append(inlineStyle);
function draftChanged(m){if(!draft)return;draft.body=m.body;composing=!!m.composing;draft.rect=m.rect;positionDraft();status(()=>tr('review.draftStatus'),'dirty')}
const inlineEditor=inlineDraftController({doc:document,onChange:draftChanged,onKey:k=>k==='cancel'?cancelDraft():submitDraft()});
function positionDraft(){if(!draft)return;const actions=$('#draft-actions');if(phone.matches){actions.style.left='';actions.style.top='';return}let r=draft.rect;if(!r)return;if(staticPreview?.active){const b=staticPreview.frame.getBoundingClientRect(),scale=b.width/staticPreview.frame.offsetWidth;r={left:b.left+r.left*scale,top:b.top+(r.top+r.height)*scale}}else r={left:r.left,top:r.top+r.height};actions.style.left=Math.max(12,Math.min(innerWidth-300,r.left))+'px';actions.style.top=Math.max(75,Math.min(innerHeight-90,r.top+8))+'px'}
async function startInline(){
 const s=elementScope(selected);if(!s||busy||draft)return;if(rewriteReason(s))return toast(()=>rewriteReason(s));
 busy=true;
 try{
  const snapshot=await api(`/api/revision/${encodeURIComponent(docId)}?anchor=${encodeURIComponent(s.anchor)}`,undefined,'GET');
  if(snapshot.baseText!==s.baseText)throw Error(tr('review.sourceChanged'));
  const foreign=snapshot.records.filter(r=>r.kind==='rewrite'&&r.status==='open'&&!r.canUpdate).flatMap(r=>{const loc=locateRecord(r,snapshot.baseText,decode);return loc.stale||loc.fallback?[]:[{id:r.id,...loc,next:decode(r.body)}]});
  draft={...s,quote:snapshot.proposedText,body:snapshot.proposedText,snapshot,foreign,requestId:crypto.randomUUID?.()||'inline'+Date.now()};
  selectionUI(null);$('#draft-actions').hidden=false;picker?.clear();
  if(staticPreview?.active)staticPreview.send({type:'inline-start',anchor:s.anchor,start:0,end:s.baseText.length,requestId:draft.requestId,html:clean.get(s.anchor).html,proposedText:snapshot.proposedText,foreign});
  else {getBlock(s.anchor).innerHTML=clean.get(s.anchor).html;inlineEditor.start(getBlock(s.anchor),0,s.baseText.length,snapshot.proposedText,foreign)}
  status(()=>tr('review.draftStatus'),'dirty');
 }catch(e){toast(()=>errorText(e));status(()=>tr('review.draftFailed'),'error')}finally{busy=false}
}
function staticSelection(m){
 const s=m.selection,c=clean.get(m.anchor),r=s?.rect,grouped=getBlock(m.anchor)?.hasAttribute('data-hs-group');
 const commentOnly=s?.commentOnly===true&&/^c3:[a-f0-9]{64}:(?:self|[0-9a-z]+(?:\.[0-9a-z]+)*)$/.test(m.anchor);
 if(!s||typeof s.quote!=='string'||!s.quote.trim()||s.quote.length>100000||!r||!['left','top','width','height'].every(k=>Number.isFinite(r[k])&&Math.abs(r[k])<100000))return null;
 if(!commentOnly&&(!c||!Number.isInteger(s.rangeStart)||!Number.isInteger(s.rangeEnd)||s.rangeStart<0||s.rangeEnd<s.rangeStart||!grouped&&c.text.slice(s.rangeStart,s.rangeEnd)!==s.quote))return null;
 const frame=staticPreview.frame,box=frame.getBoundingClientRect(),sx=box.width/frame.offsetWidth,sy=box.height/frame.offsetHeight;
 const result={anchor:m.anchor,quote:s.quote,...(commentOnly?{baseText:'',commentOnly:true}:{baseText:c.text,rangeStart:s.rangeStart,rangeEnd:s.rangeEnd}),rect:{left:box.left+(r.left+frame.clientLeft)*sx,top:box.top+(r.top+frame.clientTop)*sy}};
 if(grouped){delete result.rangeStart;delete result.rangeEnd}return result;
}
function staticMessage(m){
 if(m.type==='reading-position'){reading?.onMessage(m);return}
 if(state().interactive)return;
 if(m.type==='inline-change'){if(draft&&m.requestId===draft.requestId&&typeof m.body==='string'&&m.body.length<=200000)draftChanged(m);return}
 if(m.type==='inline-key'){if(!draft||m.requestId!==draft.requestId)return;if(m.key==='cancel')cancelDraft();else if(m.key==='submit')submitDraft();return}
 if(m.type==='elementTarget'){pickTarget(m,staticPreview.frame);return}
 if(m.type==='targetCleared'){if($('#composer').hidden)clearSelection();return}
 if(m.type==='targetMissing'){missingTarget(m.anchor);return}
 if(m.type==='located'&&m.rect&&['left','top','width','height'].every(k=>Number.isFinite(m.rect[k])&&Math.abs(m.rect[k])<100000)){document.dispatchEvent(new CustomEvent('preview-reveal',{detail:{frame:staticPreview.frame,rect:m.rect,anchor:m.anchor}}));return}
 if(m.type==='selection'){
  if(!m.selection){frameSelection=null;if(!selectionPress&&$('#composer').hidden&&(!selected?.element||m.reason==='invalid')){selected=null;selectionUI(null)}return}
  const current=staticSelection(m);if(!current)return;frameSelection=current;
  if(mode==='suggest'&&state().canSuggest&&!draft&&!composing&&$('#composer').hidden){selected=frameSelection;selectionUI(selected)}
 }else if(m.type==='input'){
  const el=getBlock(m.anchor);if(!el||typeof m.text!=='string'||m.text.length>200000||el.contentEditable!=='true'||mode==='read'||reloading||busy)return;
  // The controller validated its own document's Range before sending input.
  // A shell Selection can remain outside this hidden authority block.
  let blocked=false;beginInput({target:el,inputType:'insertText',preventDefault(){blocked=true}},null);if(blocked){staticPreview.sync();return}
  const d=difference(textOf(el),m.text),r=rangeAt(el,d.start,d.end,'[data-review-del],[data-review-point]');
  if(!r){staticPreview.sync();return}r.deleteContents();r.insertNode(document.createTextNode(d.next));handleInput({target:el});staticPreview.sync();
 }else if(m.type==='thread'&&typeof m.id==='string'&&m.id.length<256&&records.some(s=>s.id===m.id))openThreadChoices(m.ids||[m.id]);
 else if(m.type==='comment'&&mode==='suggest'&&state().canSuggest){const el=getBlock(m.anchor);selected={anchor:m.anchor,quote:el?.getAttribute('alt')||tr('review.nontext'),baseText:''};showComposer()}
 else if(m.type==='key'&&draft){if(m.key==='Escape')cancelDraft();else if(['Enter','insertParagraph','insertLineBreak'].includes(m.key))submitDraft();staticPreview.sync()}
}
function localEditing(){return !$('#composer').hidden||!!draft||composing||editTimers.size>0||editInflight>0||[...editBuffers.values()].some(b=>b.seq>b.saved)||mode==='edit'&&root.contains(document.activeElement)}
let statusCopy=null,toastCopy=null,popCopy=null;
document.addEventListener('bridge-status',()=>{statusCopy=null});
function status(text,kind='saved'){ $('#hs-status').dataset.bridgeStatus='false';statusCopy=typeof text==='function'?text:()=>text;text=statusCopy();const e=$('#hs-status');e.className='saved '+kind;e.querySelector('.txt').textContent=text}
function toast(t){toastCopy=typeof t==='function'?t:()=>t;t=toastCopy();$('#toast').textContent=t;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,4000)}
function errorText(error){
 const known=new Set(['range_overlap','revision_stale','unsupported_anchor','span_stale','not_your_doc','edit_not_allowed','suggest_not_allowed','rate_limited']);
 const message=error.reason?(known.has(error.reason)?tr('review.'+error.reason):tr('errors.reason',{reason:error.reason})):error.message;
 return message+(typeof error.existingId==='string'?tr('review.existingRevision',{id:error.existingId.slice(0,8)}):'');
}
async function api(path,body,method='POST'){
 const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await r.json().catch(()=>({}));if(!r.ok){const err=new Error(typeof data.error==='string'?data.error:'request_failed');err.reason=typeof data.error==='string'?data.error:'';err.code=r.status;err.suggestion=data.suggestion;err.existingId=data.existingId;throw err}return data;
}
function state(){return bridge.state}
function getBlock(anchor){return state().anchorMap.get(anchor)||state().anchorMap.legacy?.get(anchor)||state().commentMap.get(anchor)}
function setView(next){
 if(draft){toast(()=>tr('review.finishParagraph'));return}
 const list=next==='list';$('#annotation-list').hidden=!list;$('#threads').hidden=list;$('.discussion>.filters').hidden=list;
 document.body.classList.remove('list-view');
 $$('[data-view]').forEach(b=>{b.classList.toggle('selected',b.dataset.view===next);b.setAttribute('aria-pressed',String(b.dataset.view===next))});
 if(list){document.body.classList.remove('drawer-closed');document.body.classList.add('drawer-open');renderList()}syncDiscussion();
}
function closeNav(){document.body.classList.remove('nav-open');$('#nav-shade').hidden=true;if(innerWidth<=1100)$('#nav-toggle').setAttribute('aria-expanded','false')}
function toggleNav(force){
 if(innerWidth>1100){document.body.classList.toggle('nav-collapsed',force===undefined?!document.body.classList.contains('nav-collapsed'):!force);$('#nav-toggle').setAttribute('aria-expanded',String(!document.body.classList.contains('nav-collapsed')))}
 else{const open=force??!document.body.classList.contains('nav-open');document.body.classList.toggle('nav-open',open);$('#nav-shade').hidden=!open;$('#nav-toggle').setAttribute('aria-expanded',String(open))}
 $('#nav-toggle').setAttribute('aria-label',$('#nav-toggle').getAttribute('aria-expanded')==='true'?tr('review.collapseNav'):tr('review.expandNav'));
}
function discussionOpen(){return getComputedStyle($('#discussion')).display!=='none'}
function syncDiscussion(){const open=discussionOpen();$$('.show-discussion,.comment-toggle').forEach(b=>{b.setAttribute('aria-expanded',String(open));b.setAttribute('aria-controls','discussion');b.setAttribute('aria-label',open?tr('review.collapseDiscussion'):tr('review.openDiscussion'));b.classList.toggle('selected',open)})}
function toggleDiscussion(){if(draft)return toast(()=>tr('review.finishDraft'));if(discussionOpen())closeDiscussion();else openDiscussion()}
function closeDiscussion(){document.body.classList.remove('drawer-open');document.body.classList.add('drawer-closed');syncDiscussion()}
// Scroll only the discussion viewport, never its article/window ancestors.
function scrollThread(id){
 const card=$('#thread-'+CSS.escape(id)), viewport=$('#threads');if(!card)return;
 const box=card.getBoundingClientRect(), view=viewport.getBoundingClientRect();
 if(box.top<view.top||box.bottom>view.bottom)viewport.scrollTop+=box.top-view.top;
}
function openDiscussion(id){dismissTarget();clearSelection();if(draft)return toast(()=>tr('review.finishDraft'));setView('article');if(id){active=id;filter='all';$$('[data-filter]').forEach(b=>b.classList.toggle('selected',b.dataset.filter===filter))}document.body.classList.remove('drawer-closed');document.body.classList.add('drawer-open');syncDiscussion();renderThreads();if(id){marks.focus(id);staticPreview?.send({type:'tag-focus',id});if(state().interactive)state().frame?.contentWindow?.postMessage({type:'tag-focus',id},'*');requestAnimationFrame(()=>scrollThread(id))}}
function openThreadChoices(ids){ids=[...new Set(ids)].filter(id=>records.some(r=>r.id===id));if(!ids.length)return;if(ids.length===1)return openDiscussion(ids[0]);openDiscussion();pop(()=>'<h3>'+tr('review.choicesHeading',{count:ids.length})+'</h3>'+ids.map(id=>{const r=records.find(s=>s.id===id);return `<button data-choose-thread="${esc(id)}">${r.kind==='rewrite'?tr('review.revision'):tr('review.annotation')} · ${esc(decode(r.author))} · ${esc(decode(r.body||r.quote).slice(0,75))}</button>`}).join(''));$('#popover').onclick=e=>{const id=e.target.closest('[data-choose-thread]')?.dataset.chooseThread;if(id){closePop();openDiscussion(id)}}}
const marks=annotationAffordances({doc:document,onOpen:openThreadChoices,resolveTarget:a=>a.match(/^c[23]:/)?picker?.resolve(a):null});
function commentGroups(){const groups=new Map();for(const r of records){if(r.status!=='open'||staleReason(r)||!['comment','rewrite'].includes(r.kind))continue;const key=r.anchor+':'+r.kind;if(!groups.has(key))groups.set(key,{anchor:r.anchor,kind:r.kind,ids:[]});groups.get(key).ids.push(r.id)}return [...groups.values()]}
function locate(id,open=true){
 const s=records.find(x=>x.id===id);if(!s)return;if(open)openDiscussion(id);if(staleReason(s)&&!retryElement(s))return;else if(!open&&innerWidth<=1100)closeDiscussion();
 $$('.record-focus').forEach(n=>n.classList.remove('record-focus'));
 if(state().interactive){state().frame?.contentWindow?.postMessage({type:'flashComment',anchor:s.anchor,highlight:s.status==='open'},'*');return}
 if(staticPreview?.active){staticPreview.send({type:'locate',id,anchor:s.anchor,highlight:s.status==='open'});return}
 if(s.anchor?.match(/^c[23]:/)){picker?.reveal(s.anchor).then(el=>{if(el===false)return;if(el){targetFound(s.anchor);el.scrollIntoView({block:'center'});picker.refresh()}else missingTarget(s.anchor)});return}
 const loc=locations.get(id);if(loc?.stale){toast(()=>loc.reason);return}
 const el=root.querySelector(`[data-thread="${CSS.escape(id)}"]`)||getBlock(s.anchor?.startsWith('m:')?s.anchor.slice(2).split(',')[0]:s.anchor);
 if(el){if(s.status==='open')el.classList.add('record-focus');el.scrollIntoView({block:'center'});if(loc?.fallback)toast(()=>loc.reason)}else toast(()=>tr('review.missingParagraph'));
}
function retryElement(s){return s.kind==='comment'&&/^c[23]:/.test(s.anchor)&&!s.stale_reason&&!s.invalid_reason&&s.status!=='stale'}
function targetFound(anchor){let changed=false;for(const r of records)if(r.anchor===anchor&&retryElement(r)&&locations.get(r.id)?.stale){locations.set(r.id,{fallback:true,get reason(){return tr('review.elementComment')}});changed=true}if(changed){syncCommentState();render(true)}}
document.addEventListener('preview-reveal',e=>targetFound(e.detail?.anchor));
function missingTarget(anchor){for(const r of records)if(r.anchor===anchor)locations.set(r.id,{stale:true,get reason(){return tr('review.missingElementReason')}});render();toast(()=>tr('review.missingElement'))}
function pendingRecord(s){return s.status==='open'||s.kind==='rewrite'&&s.status==='stale'}
function staleReason(s){return s.stale_reason||s.invalid_reason||(s.status==='stale'?tr('review.staleReason'):locations.get(s.id)?.stale?locations.get(s.id).reason:'')}
function rewriteActions(t){if(t.kind!=='rewrite'||!pendingRecord(t)||!state().isDocOwner)return '';return `<div class="thread-actions">${staleReason(t)?`<button data-stale-resolve="${esc(t.id)}" ${pendingComments.has(t.id)?'disabled aria-busy="true"':''}>${tr('review.resolveStale')}</button>`:`<button class="accept" data-accept="${esc(t.id)}">${tr('review.accept')}</button><button data-reject="${esc(t.id)}">${tr('review.reject')}</button>`}</div>`}
function statusText(s){return s.resolved_stale?tr('review.handledStale'):({open:staleReason(s)&&s.kind==='rewrite'?tr('review.pendingStale'):tr('review.pending'),accepted:tr('review.accepted'),rejected:s.kind==='comment'?tr('review.resolved'):tr('review.rejected'),withdrawn:tr('review.withdrawn'),stale:s.kind==='rewrite'?tr('review.pendingStale'):tr('review.anchorStale')}[s.status]||s.status)}
function typeText(s){return s.kind==='comment'?tr('review.comment'):tr('review.suggestion')}
function quoteHtml(s){return s.kind==='rewrite'?`<del style="color:#92584e">${esc(decode(s.quote))||tr('review.noDeletion')}</del> → <span style="color:#285d48">${esc(decode(s.body))||tr('review.deleteHere')}</span>`:esc(decode(s.quote))}
function renderList(preserve=false,localeOnly=false){
 const matches=records.filter(t=>(listStatus==='all'||(listStatus==='open'?pendingRecord(t):!pendingRecord(t)))&&(listType==='all'||t.kind===(listType==='suggestion'?'rewrite':listType)));
 $('#list-summary').textContent=tr('review.listSummary',{shown:matches.length,total:records.length,pending:records.filter(pendingRecord).length});
 const viewport=$('#annotation-list'),scroll=viewport.scrollTop,container=$('#list-records');const html=matches.map(t=>`<section id="list-${esc(t.id)}" data-list-card="${esc(t.id)}"><button class="annotation-row" data-record="${esc(t.id)}"><span class="row-meta"><span class="avatar">${esc([...t.author||tr('review.guestInitial')][0])}</span><strong>${esc(t.author||tr('review.guest'))}</strong><span class="row-type">${typeText(t)}</span><span class="status">${statusText(t)}</span></span><span class="row-quote">${esc(decode(t.quote))||tr('review.insertHere')}</span><span class="row-body">${t.kind==='comment'?esc(decode(t.body)):quoteHtml(t)}</span><span class="row-link">${staleReason(t)?tr('review.viewProposal'):tr('review.viewSource')}${t.replies?.length?' · '+tr('review.replies',{count:t.replies.length}):''}${locations.get(t.id)?.stale?' · '+tr('review.referenceStale'):''}</span></button><div class="row-action">${t.kind==='comment'&&t.status==='rejected'&&state().isDocOwner?`<button data-list-reopen="${esc(t.id)}" ${pendingComments.has(t.id)?'disabled aria-busy="true"':''}>${tr('review.reopen')}</button>`:''}</div></section>`).join('')||`<div class="empty">${tr('review.noMatches')}</div>`;
 if(localeOnly){patchShell(container,html);return}if(!preserve)container.innerHTML=html;else{const template=document.createElement('template');template.innerHTML=html;const wanted=new Set();for(const card of [...template.content.children]){wanted.add(card.id);const old=card.id&&document.getElementById(card.id);if(old){for(const selector of ['.status','.row-link','.row-action']){const a=old.querySelector(selector),b=card.querySelector(selector);if(a&&b&&a.outerHTML!==b.outerHTML)a.replaceWith(b)}}else{let next=card.nextElementSibling;while(next&&!document.getElementById(next.id))next=next.nextElementSibling;container.insertBefore(card,next?document.getElementById(next.id):null)}}for(const n of [...container.children])if(!wanted.has(n.id))n.remove()}
 viewport.scrollTop=scroll;
}
function renderThreads(preserve=false,localeOnly=false){
 const items=records.filter(t=>filter==='all'||(filter==='done'?!pendingRecord(t):pendingRecord(t)));
 const viewport=$('#threads'), scroll=viewport.scrollTop;const html=items.map(t=>`<section class="thread ${active===t.id?'active':''} ${!pendingRecord(t)?'resolved':''}" id="thread-${esc(t.id)}" data-card="${esc(t.id)}"><div class="thread-top"><span class="avatar">${esc([...t.author||tr('review.guestInitial')][0])}</span><strong>${esc(t.author||tr('review.guest'))}</strong><span class="time">${esc(date(t.created_at,{month:'short',day:'numeric',year:'numeric'}))}</span></div><span class="thread-type">${t.kind==='rewrite'?'↗':'●'} ${typeText(t)}${t.status!=='open'?' · '+statusText(t):''}</span><div class="quote">${quoteHtml(t)}</div><p class="thread-summary">${t.kind==='comment'?esc(decode(t.body)):staleReason(t)?esc(t.resolved_stale?tr('review.staleHandledHelp'):tr('review.staleHelp')):t.status==='open'?tr('review.awaitOwner'):statusText(t)}</p>${staleReason(t)?`<p class="stale">${esc(staleReason(t))}</p>`:''}${(t.replies||[]).map(r=>`<div class="reply"><b>${esc(r.author)}</b><br>${esc(decode(r.body))}</div>`).join('')}${rewriteActions(t)}<div class="thread-footer">${staleReason(t)&&!retryElement(t)?`<span>${tr('review.referenceStale')}</span>`:`<button data-locate="${esc(t.id)}">↗ ${locations.get(t.id)?.stale?tr('review.retryLocate'):tr('review.locate')}</button>`}<span>${state().canSuggest?`<button data-reply="${esc(t.id)}">${tr('review.reply')}</button>`:''}${t.kind==='comment'&&t.status==='open'&&state().isDocOwner?`<button data-resolve="${esc(t.id)}" ${pendingComments.has(t.id)?'disabled aria-busy="true"':''}>${tr('review.resolve')}</button>`:''}${t.kind==='comment'&&t.status==='rejected'&&state().isDocOwner?`<button data-reopen="${esc(t.id)}" ${pendingComments.has(t.id)?'disabled aria-busy="true"':''}>${tr('review.reopen')}</button>`:''}</span></div></section>`).join('')||`<div class="empty">${tr('review.noThreads')}</div>`;
 // Keyed cards: preserve existing cards, expanded state, focus and local scroll.
 if(localeOnly){patchShell(viewport,html);return}if(!preserve){viewport.innerHTML=html;viewport.scrollTop=scroll;return}
 const template=document.createElement('template');template.innerHTML=html;const wanted=new Set();
 for(const card of [...template.content.children]){const old=card.id&&document.getElementById(card.id);wanted.add(card.id);if(old){if(old.outerHTML!==card.outerHTML){old.className=card.className;for(const selector of ['.thread-type','.thread-summary','.stale','.thread-footer','.thread-actions']){const next=card.querySelector(selector),prior=old.querySelector(selector);if(prior&&next)prior.replaceWith(next);else if(prior)prior.remove();else if(next)old.append(next)}}}else{let next=card.nextElementSibling;while(next&&!document.getElementById(next.id))next=next.nextElementSibling;viewport.insertBefore(card,next?document.getElementById(next.id):null)}}
 for(const card of [...viewport.children])if(!wanted.has(card.id))card.remove();viewport.scrollTop=scroll;
}
function render(preserve=false){const count=records.filter(pendingRecord).length;$$('.total').forEach(n=>n.textContent=number(count));renderList(preserve);renderThreads(preserve)}
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
 }else if(s.kind==='comment'){span.tabIndex=0;span.setAttribute('role','button');span.setAttribute('aria-label',tr('review.openMark'))}
 return true;
}
function decorate(){
 clearSelection();if(state().interactive){syncCommentState();return}restoreClean();locations=new Map();
 for(const s of records){
  if(s.anchor?.startsWith('m:')){const el=getBlock(s.anchor.slice(2).split(',')[0]);locations.set(s.id,el?{fallback:true,get reason(){return tr('review.legacyMulti')}}:{stale:true,get reason(){return tr('review.paragraphUnlocated')}});continue}
  if(s.anchor?.match(/^c[23]:/)){locations.set(s.id,{fallback:true,get reason(){return tr('review.elementComment')}});continue}
  const el=getBlock(s.anchor), original=clean.get(s.anchor)||clean.get(el?.dataset.hsAnchor);
  if(!el){locations.set(s.id,{stale:true,get reason(){return tr('review.paragraphDeleted')}});continue}
  if(!original){locations.set(s.id,{fallback:true,get reason(){return tr('review.nontextComment')}});if(s.status==='open')el.dataset.reviewBlockThread=s.id;continue}
  const loc=s.kind==='rewrite'&&(s.invalid_reason||s.stale_reason||s.status==='stale')?{stale:true,reason:staleReason(s)}:el.hasAttribute('data-hs-group')?{fallback:true,get reason(){return tr('review.groupComment')}}:locateRecord(s,original.text,decode,el);locations.set(s.id,loc);
  if(loc.stale||draft?.anchor===s.anchor||s.status!=='open')continue;
  if(loc.fallback){if(s.status==='open')el.dataset.reviewBlockThread=s.id;continue}
  // Pending rewrites are handled after comments so offsets refer only to accepted text.
  if(s.kind==='rewrite'||mode==='edit')continue;
  wrapRange(el,loc,s,'comment');
 }
 for(const s of records.filter(t=>t.kind==='rewrite')){
  const loc=locations.get(s.id),el=getBlock(s.anchor);if(!loc||loc.stale||loc.fallback||draft?.anchor===s.anchor||!el||mode==='edit')continue;
  if(s.status==='open')wrapRange(el,loc,s,'rewrite');
 }
 applyMode();
 syncCommentState();
}
function syncCommentState(){
 const comments=records.filter(r=>r.kind==='comment').map(r=>({id:r.id,anchor:r.anchor,open:r.status==='open'&&mode!=='edit',quote:decode(r.quote),baseText:decode(r.base_text),rangeStart:r.range_start,rangeEnd:r.range_end,...locations.get(r.id)}));
 marks.comments(comments,draft?.anchor);
 const groups=commentGroups();marks.sync(staticPreview?.active||state().interactive?[]:groups,phone.matches);
 const retired=records.filter(r=>r.kind==='rewrite'&&(r.status!=='open'||staleReason(r))).map(r=>r.id);marks.retireRewrites(retired,draft?.anchor);
 staticPreview?.send({type:'comment-state',comments,groups,retired,mobile:phone.matches});
 if(state().interactive)state().frame?.contentWindow?.postMessage({type:'comment-state',comments,groups,mobile:phone.matches},'*');
}
function updateComment(s){
 const index=records.findIndex(r=>r.id===s.id);if(index<0)return;
 const focused=document.activeElement, card=focused?.closest('[data-card],[data-list-card]'), nearby=card?.nextElementSibling?.id||card?.previousElementSibling?.id,list=!!focused?.closest('[data-list-card]');
 records[index]=s;if(active===s.id&&s.status!=='open')active=null;
 syncCommentState();render(true);
 if(card&&!focused.isConnected){const next=$((list?'#list-':'#thread-')+CSS.escape(s.id))||nearby&&document.getElementById(nearby);(next?.querySelector('[data-reopen],[data-list-reopen],[data-resolve],button')||$('.discussion-head button'))?.focus({preventScroll:true})}
}
async function resolveComment(id,action){
 const current=records.find(r=>r.id===id);
 if(!current||!(action==='resolve-stale'?current.kind==='rewrite':current.kind==='comment')||!state().isDocOwner||pendingComments.has(id)||reloading)return;
 if(action==='reopen'?current.status!=='rejected':action==='resolve-stale'?!pendingRecord(current):current.status!=='open')return;
 const source=state().frame, anchorMap=state().anchorMap;pendingComments.add(id);commentVersion++;
 const buttons=()=>$$(`[data-resolve="${CSS.escape(id)}"],[data-reopen="${CSS.escape(id)}"],[data-list-reopen="${CSS.escape(id)}"],[data-stale-resolve="${CSS.escape(id)}"]`);for(const button of buttons()){button.disabled=true;button.setAttribute('aria-busy','true')}
 try{
  const data=await api(`/api/suggest/${encodeURIComponent(docId)}/${encodeURIComponent(id)}/${action}`);
  if(state().frame!==source||state().anchorMap!==anchorMap||!records.some(r=>r.id===id))return;
  const s=data.suggestion;if(!s||s.id!==id||s.doc_id!==docId||s.kind!==current.kind)throw Error(tr('review.invalidStatus'));
  updateComment(s);status(()=>s.resolved_stale?tr('review.staleHandled'):s.status==='open'?tr('review.reopened'):tr('review.commentResolved'));
 }catch(e){toast(()=>tr('review.updateFailed',{reason:errorText(e)}));status(()=>errorText(e),'error')}
 finally{pendingComments.delete(id);commentVersion++;for(const b of buttons()){b.disabled=false;b.removeAttribute('aria-busy')}}
}
async function refresh(reload=false){
 if(refreshBusy||localEditing()||pendingComments.size)return;refreshBusy=true;const version=commentVersion;
 try{
  if(reload){reloading=true;root.inert=true;await bridge.reload();await staticPreview?.reconnect();captureClean();editBuffers.clear();buildToc()}
  const r=await fetch(`/api/suggestions/${encodeURIComponent(docId)}?status=all`);
  if(r.status===403){records=[];locations.clear();syncCommentState();render();$('#threads').innerHTML=`<div class="empty">${tr('review.readOnlyRecords')}</div>`;return}
  if(!r.ok)throw Error(tr('review.loadCommentsFailed'));const next=(await r.json()).suggestions||[];if(version!==commentVersion||pendingComments.size)return;const same=JSON.stringify(next)===JSON.stringify(records);const withoutStatus=rows=>JSON.stringify(rows.map(({status,invalid_reason,resolved_stale,stale_reason,...r})=>r));const statusOnly=withoutStatus(next)===withoutStatus(records);records=next;if(!localEditing()&&(!same||reload)){if(statusOnly&&!reload)syncCommentState();else decorate();render(statusOnly&&!reload)}
 }catch(e){status(()=>errorText(e),'error')}finally{refreshBusy=false;reloading=false;root.inert=false}
}
function applyMode(){
 const caps=state();bridge.setMode(caps.interactive?(mode==='read'?'use':mode):'view');
 $$('[data-mode]').forEach(b=>{const m=b.dataset.mode;b.disabled=(m==='edit'&&!caps.canEdit)||(m==='suggest'&&!caps.canSuggest);b.classList.toggle('selected',m===mode);b.setAttribute('aria-pressed',String(m===mode));if(b.disabled)bind(b,m==='edit'?'review.noDirectEdit':'review.noLinkSuggest',{},'title')});
 if(!caps.interactive)for(const [a,el] of caps.anchorMap){const locked=records.some(s=>s.anchor===a&&s.status==='open'&&s.kind==='rewrite');const grouped=el.hasAttribute('data-hs-group');el.contentEditable=String(mode==='edit'&&caps.canEdit&&!el.querySelector('math,.katex'));if(grouped&&mode==='suggest')el.title=tr('review.groupRevisionHelp')}
 picker?.refresh();staticPreview?.sync();
}
function changeMode(next){if(!$('#composer').hidden)return toast(()=>tr('review.finishComment'));if(editTimers.size||editInflight||[...editBuffers.values()].some(b=>b.seq>b.saved))return toast(()=>tr('review.savingMode'));if(draft)return toast(()=>tr('review.finishCurrentDraft'));if(next==='edit'&&!state().canEdit||next==='suggest'&&!state().canSuggest)return;mode=next;decorate();applyMode();clearSelection()}
function buildToc(){
 const title=root.querySelector('h1')?.textContent?.trim()||docId;$('#hs-docname').textContent=title;document.title=title+' · Marginroom';
 $('#toc').innerHTML='';root.querySelectorAll('h1,h2,h3').forEach((h,i)=>{const b=document.createElement('button');b.className='sub';b.textContent=h.textContent.trim();b.onclick=()=>{setView('article');closeNav();if(staticPreview?.active&&h.dataset.hsAnchor)staticPreview.send({type:'locate',anchor:h.dataset.hsAnchor,id:''});else h.scrollIntoView({block:'start'})};$('#toc').append(b)});
}
function selectionInfo(){
 if(staticPreview?.active)return frameSelection;
 const sel=getSelection();if(!sel?.rangeCount||sel.isCollapsed)return null;
 const block=singleBlockRange(sel.getRangeAt(0));if(!block||!root.contains(block.el))return null;
 const {range:r,el}=block,node=r.startContainer.nodeType===1?r.startContainer:r.startContainer.parentElement;
 if(el.hasAttribute('data-hs-group')){const value=logicalSelection(el,r);return value?{anchor:el.dataset.hsAnchor,baseText:bridge.readText(el),quote:value.quote,rect:r.getBoundingClientRect()}:null;}
 if(r.cloneContents().querySelector('[data-review-ins]')||node.closest('[data-review-ins]'))return null;
 const value=logicalSelection(el,r,'[data-review-ins],[data-review-point]');if(!value||!value.quote.trim())return null;
 return {anchor:el.dataset.hsAnchor,baseText:clean.get(el.dataset.hsAnchor)?.text??logicalText(el),quote:value.quote,rangeStart:value.start,rangeEnd:value.end,rect:r.getBoundingClientRect()};
}
// Store quote + logical offsets, never a live Range that focus or decoration can mutate.
let selectionPress=null, selectionPressTimer;
const phone=matchMedia('(max-width:600px)');
function selectionUI(s){
 const scope=elementScope(s);$('#selection-context').classList.toggle('element-target',!!s?.element);
 const available=!!s&&mode==='suggest'&&$('#composer').hidden&&!draft&&!composing;
 $('#mobile-selection').hidden=!(available&&phone.matches&&!s.element);
 $('.dock').classList.toggle('has-selection',available&&phone.matches&&!s.element);
 $('#selection-context').hidden=!(available&&(!phone.matches||s.element));
 $('#selection-action').hidden=!available||(phone.matches&&!s.element);
 $('#selection-suggest').hidden=!available||!scope;
 const reason=scope?rewriteReason(scope):null,overlap=reason?.id;
 $('#selection-suggest').disabled=!!reason&&!overlap;
 if(!$('#selection-suggest svg'))$('#selection-suggest').innerHTML=icon('edit',{size:16})+'<span></span>';bind($('#selection-suggest span'),overlap?'review.viewRevision':'review.inlineEdit');
 $('#selection-suggest').title=reason?.text||reason||tr('review.inlineHint');
 let note=$('#rewrite-reason');if(!note){note=document.createElement('span');note.id='rewrite-reason';note.setAttribute('role','status');$('#selection-context').append(note)}note.textContent=reason?.text||reason||'';note.hidden=!reason;
 $('#target-label').textContent=s?.element?s.quote:'';$('#target-label').title=s?.element?(scope?.quote||s.context||s.quote):'';$('#target-tag').textContent=s?.tag||s?.quote?.split(/[ :]/)[0]||'';$('#target-heading').hidden=!available||!s.element;
 $('#target-navigation').hidden=!available||!s.element;
 $('#target-parent').disabled=!s?.parent;
 $('#mobile-selection [role="status"]').textContent=reason?.text||reason||(s?.element?tr('review.selectedElement'):tr('review.selectedText'));
 if(available&&!phone.matches){const pop=$('#selection-context'),stage=$('#article').getBoundingClientRect(),left=Math.max(8,stage.left+8),right=Math.min(innerWidth-8,stage.right-8),top=Math.max(70,stage.top+8),bottom=Math.min(innerHeight-12,stage.bottom-8);pop.style.left=Math.max(left,Math.min(right-pop.offsetWidth,s.rect.left))+'px';const height=pop.offsetHeight,above=s.rect.top-height-10;pop.style.top=Math.max(top,Math.min(bottom-height,above>=top?above:s.rect.top+(s.rect.height||0)+10))+'px'}
}
function clearSelection(remove=false){if(!$('#composer').hidden)return;clearTimeout(selectionPressTimer);selectionPress=null;selectionCapture=null;selected=null;frameSelection=null;selectionUI(null);if(remove){getSelection()?.removeAllRanges();staticPreview?.send({type:'clear-selection'})}}
let dismissedSelection=null;
function selectionStamp(){const s=getSelection();if(!s?.rangeCount||s.isCollapsed)return null;const r=s.getRangeAt(0);return [r.startContainer,r.startOffset,r.endContainer,r.endOffset]}
function dismissTarget(focus=false){
 if(!selected||!$('#composer').hidden||draft||composing||openingComposer)return false;
 dismissedSelection=selectionStamp();clearSelection();picker?.clear();
 if(staticPreview?.active)staticPreview.send({type:'clearTarget'});
 else if(state().interactive)state().frame?.contentWindow?.postMessage({type:'clearTarget'},'*');
 if(focus){const destination=staticPreview?.active?staticPreview.frame:state().interactive?state().frame:root;if(destination===root&&!root.hasAttribute('tabindex'))root.tabIndex=-1;destination?.focus({preventScroll:true})}
 return true;
}
function captureSelection(){
 if(selectionPress||!$('#composer').hidden)return;
 const stamp=selectionStamp();if(dismissedSelection&&stamp&&dismissedSelection.every((v,i)=>v===stamp[i]))return;dismissedSelection=null;
 // A shell selectionchange must not turn an explicit frame element pick back
 // into the frame's previous native text range. Fresh frame ranges arrive via
 // staticMessage, in the owning document.
 if(staticPreview?.active&&selected?.element){selectionUI(selected);return}
 if(mode!=='suggest'||composing||draft||reloading||!state().canSuggest||state().interactive){clearSelection();return}
 const info=selectionInfo();if(info)selected=info;else if(!selected?.element)selected=null;selectionUI(selected);
}
function armSelection(e){
 const s=selected?.element?selected:selectionInfo()||selected;if(!s)return;
 selectionPress={...s};clearTimeout(captureSelection.timer);
 if(staticPreview?.active&&!s.element){selectionCapture=staticPreview.captureSelection();selectionCapture.catch(()=>{})}
 // Prevent focus only on our action, never on the article or native selection UI.
 e.preventDefault();clearTimeout(selectionPressTimer);
 selectionPressTimer=setTimeout(()=>{selectionPress=null;captureSelection()},1500);
}
let openingComposer=false,selectionCapture=null;
async function showComposer(id,kind='comment'){
 if(openingComposer)return;
 if(!state().canSuggest)return;
 if(!id&&staticPreview?.active&&!selected?.element){openingComposer=true;try{const m=await (selectionCapture||staticPreview.captureSelection());if(m.reason==='invalid'){clearSelection();return}if(m.selection){const current=staticSelection(m);if(!current){clearSelection();return}selectionPress=current}}catch(e){toast(()=>errorText(e));return}finally{openingComposer=false;selectionCapture=null}}
 if(!$('#composer').hidden||draft||busy)return;
 if(!id){selected=selectionPress||(selected?.element?selected:selectionInfo()||selected);if(!selected||(!state().interactive&&selected.rangeStart!=null&&!getBlock(selected.anchor)))return}
 if(kind==='rewrite'){if(!selected?.element)return;clearTimeout(selectionPressTimer);selectionPress=null;startInline();return}
 composeKind=kind;clearTimeout(selectionPressTimer);selectionPress=null;replyTo=id||null;showComposer.requestId=crypto.randomUUID?.()||'r'+Date.now();
 selectionUI(null);bind($('#composer-title'),id?'review.replyTitle':kind==='rewrite'?'review.suggestTitle':'review.writeComment');$('#selected-quote').textContent=id?decode(records.find(s=>s.id===id)?.quote):selected.quote;$('#comment-body').value='';bind($('#send-comment'),id?'review.reply':kind==='rewrite'?'review.submitRevision':'review.writeComment');$('#composer').hidden=false;$('#composer').showModal();$('#comment-body').focus({preventScroll:true});$('#comment-body').scrollTop=0;
}
function unsavedEdits(){return editTimers.size>0||editInflight>0||[...editBuffers.values()].some(b=>b.seq>b.saved)}
function typedComment(){return !$('#composer').hidden&&$('#comment-body').value.length>0}
function unsavedDrafts(){return typedComment()||!!draft&&draft.body!==draft.quote||unsavedEdits()||composing}
let leaveIntent=null,leaveFocus=null,leaving=false;
function requestLeave(intent='home'){
 if(busy)return toast(()=>tr('review.submitting'));
 if(!unsavedDrafts()){if(intent==='home'){reading?.persist();location.assign('/')}else closeComposer(true);return}
 leaveIntent=intent;leaveFocus=document.activeElement;
 bind($('#leave-message'),unsavedEdits()?'review.leaveEdits':'review.leaveDraft');
 bind($('#leave-discard'),intent==='home'?'review.discardHome':'review.discardClose');
 bind($('#leave-save'),intent==='home'?'review.saveHome':'review.saveClose');
 $('#leave-dialog').showModal();
}
function stayHere(){if(leaving)return;$('#leave-dialog').close();leaveIntent=null;leaveFocus?.focus({preventScroll:true})}
async function finishLeave(save){
 if(leaving||busy)return;
 if(editInflight&&!save){bind($('#leave-message'),'review.savingLeave');return}
 if(composing)return toast(()=>tr('review.finishInput'));
 leaving=true;for(const b of $('#leave-dialog').querySelectorAll('button'))b.disabled=true;
 try{
  if(save){
   if(typedComment())await sendComment();
   if(draft&&draft.body!==draft.quote)await submitDraft();
   // Flush debounce timers and retry failed buffers, without dropping newer text.
   for(const [a,b] of editBuffers)if(b.seq>b.saved){const el=getBlock(a);if(el)await saveEdit(el)}
   if(unsavedDrafts()){bind($('#leave-message'),'review.stillUnsaved');return}
  }else if(leaveIntent==='home'){for(const t of editTimers.values())clearTimeout(t);editTimers.clear();editBuffers.clear()}
  const intent=leaveIntent;$('#leave-dialog').close();leaveIntent=null;
  if(intent==='home'){reading?.persist();if(draft)cancelDraft();closeComposer(true);location.assign('/')}
  else{if(draft)cancelDraft();closeComposer(true)}
 }finally{leaving=false;for(const b of $('#leave-dialog').querySelectorAll('button'))b.disabled=false}
}
function closeComposer(force=false){if(busy)return;if(force!==true&&typedComment()){requestLeave('composer');return}$('#composer').close();$('#composer').hidden=true;$('#comment-body').value='';$('#shade').hidden=true;replyTo=null;clearSelection(true)}
async function sendComment(){
 const body=$('#comment-body').value.trim();if((!body&&composeKind!=='rewrite')||busy)return;busy=true;$('#send-comment').disabled=true;
 try{let id=replyTo;
  if(id)await api(`/api/suggest/${encodeURIComponent(docId)}/${encodeURIComponent(id)}/replies`,{body,author:myName,requestId:showComposer.requestId});
  else{const res=await api(`/api/suggest/${encodeURIComponent(docId)}`,{anchor:selected.anchor,quote:selected.quote,baseText:selected.baseText,rangeStart:selected.rangeStart,rangeEnd:selected.rangeEnd,body,kind:composeKind,author:myName,requestId:selected.requestId||(selected.requestId=crypto.randomUUID?.()||'c'+Date.now())});id=res.suggestion.id}
  busy=false;closeComposer(true);await refresh();openDiscussion(id);status(()=>tr('review.commentSaved'));getSelection()?.removeAllRanges();
 }catch(e){toast(()=>errorText(e));status(()=>tr('review.commentFailed'),'error')}finally{busy=false;$('#send-comment').disabled=false}
}

function cancelDraft(){if(!draft||busy)return;const saved=draft;inlineEditor.stop();staticPreview?.send({type:'inline-stop'});draft=null;composing=false;$('#draft-actions').hidden=true;decorate();if(staticPreview?.active)staticPreview.send({type:'restore-selection',anchor:saved.anchor,start:saved.rangeStart,end:saved.rangeEnd});else inlineEditor.restoreSelection(getBlock(saved.anchor),saved.rangeStart,saved.rangeEnd);status(()=>tr('review.draftCanceled'))}
async function submitDraft(){
 if(!draft||busy||composing)return;const current=draft;if(current.quote===current.body){cancelDraft();return}
 busy=true;$('#submit-draft').disabled=true;
 try{
  const payload={anchor:current.anchor,version:current.snapshot.version,sourceHash:current.snapshot.sourceHash,proposedText:current.body,requestId:current.requestId,author:myName};
  // A changed payload needs a fresh receipt key after a rejected/ambiguous retry.
  const serialized=JSON.stringify(payload);if(current.attempt&&current.attempt!==serialized){current.requestId=crypto.randomUUID();payload.requestId=current.requestId}current.attempt=JSON.stringify(payload);
  const res=await api(`/api/revision/${encodeURIComponent(docId)}`,payload);
  inlineEditor.stop();staticPreview?.send({type:'inline-stop'});draft=null;$('#draft-actions').hidden=true;await refresh();active=res.snapshot.records.find(r=>r.canUpdate)?.id||null;render();status(()=>tr('review.revisionSaved'));toast(()=>tr('review.sourceUnchanged'));
 }catch(e){toast(()=>errorText(e));status(()=>tr('review.draftRetained'),'error')}finally{busy=false;$('#submit-draft').disabled=false}
}
function beginInput(e,sel=getSelection()){
 if(e.target.closest?.('[data-inline-editor]'))return;
 if(reloading){e.preventDefault();return}
 if(mode!=='edit'||state().interactive){e.preventDefault();return;}
 const el=e.target.closest?.('[data-hs-anchor]');if(!el)return;
 if(sel?.rangeCount){const r=sel.getRangeAt(0),block=singleBlockRange(r,el);if(!block){e.preventDefault();toast(()=>tr('review.singleEdit'));return}if(!el.contains(r.endContainer)){sel.removeAllRanges();sel.addRange(block.range)}}

}
function handleInput(e){
 if(e.target.closest?.('[data-inline-editor]'))return;
 const el=e.target.closest?.('[data-hs-anchor]');if(!el||composing||state().interactive)return;
 if(mode==='edit'&&state().canEdit){queueEdit(el)}
}
const editTimers=new Map();let editInflight=0;
function queueEdit(el){
 const a=el.dataset.hsAnchor, prior=editBuffers.get(a)||{seq:0,saved:0,saving:false};
 prior.seq++;prior.text=el.hasAttribute('data-hs-group')?bridge.readText(el):textOf(el);prior.html=el.innerHTML;editBuffers.set(a,prior);
 clean.set(a,{html:prior.html,text:prior.text});
 clearTimeout(editTimers.get(a));editTimers.set(a,setTimeout(()=>saveEdit(el),700));status(()=>tr('review.editing'),'dirty');
}
async function saveEdit(el){
 const a=el.dataset.hsAnchor;clearTimeout(editTimers.get(a));editTimers.delete(a);const buffer=editBuffers.get(a);
 if(!buffer||buffer.saving||buffer.saved===buffer.seq)return;
 const seq=buffer.seq,text=buffer.text;buffer.saving=true;editInflight++;
 try{const data=await api(`/api/edit/${encodeURIComponent(docId)}`,{anchor:a,text});buffer.saved=seq;overlaySignature=JSON.stringify(data.overlay);status(()=>buffer.seq===seq?tr('review.sourceSaved'):tr('review.savingMore'),buffer.seq===seq?'saved':'dirty')}
 catch(e){status(()=>tr('review.saveFailed',{reason:errorText(e)}),'error');toast(()=>errorText(e))}
 finally{buffer.saving=false;editInflight--;if(buffer.seq>seq)saveEdit(el)}
}
async function decide(id,action){
 if(editTimers.size||editInflight||[...editBuffers.values()].some(b=>b.seq>b.saved))return toast(()=>tr('review.waitSave'));
 if(action==='accept'&&locations.get(id)?.stale)return toast(()=>tr('review.cannotAccept'));
 if(busy||draft)return;busy=true;
 try{await api(`/api/suggest/${encodeURIComponent(docId)}/${encodeURIComponent(id)}/${action}`,undefined);await refresh(true);status(()=>action==='accept'?tr('review.revisionAccepted'):tr('review.annotationHandled'))}
 catch(e){toast(()=>errorText(e));if(e.suggestion?.id===id&&e.suggestion.doc_id===docId){commentVersion++;updateComment(e.suggestion)}else await refresh(false);status(()=>errorText(e),e.code===409?'saved':'error')}finally{busy=false}
}
let popTrigger=null;
function closePop(restore=false){$('#popover').hidden=true;popTrigger?.setAttribute('aria-expanded','false');if(restore)popTrigger?.focus({preventScroll:true})}
function sizePop(){const panel=$('#popover');if(panel.hidden)return;const vv=window.visualViewport,top=Math.max(80,(vv?.offsetTop||0)+8),bottom=(vv?.offsetTop||0)+(vv?.height||innerHeight);panel.style.top=top+'px';panel.style.maxHeight=Math.max(0,bottom-top-8)+'px'}
function pop(html,opener=null){closePop();popTrigger=opener; if(!['name-btn','share-btn','more-btn'].includes(popTrigger?.id))popTrigger=null;popTrigger?.setAttribute('aria-controls','popover');popTrigger?.setAttribute('aria-expanded','true');popCopy=typeof html==='function'?html:()=>html;html=popCopy();$('#popover').innerHTML=html;$('#popover').hidden=false;sizePop();$('#popover').querySelector('input,button,select')?.focus({preventScroll:true})}
function paintName(){$$('.my-avatar').forEach(n=>n.textContent=[...myName][0]);$('.person-name').textContent=myName}
function nameMenu(){pop(()=>`<h3>${tr('review.nameTitle')}</h3><p>${tr('review.nameHelp')}</p><input id="review-name" aria-label="${tr('review.reviewName')}" maxlength="80" value="${esc(myName)}"><button id="save-name" class="primary" style="margin-top:12px">${tr('review.confirm')}</button>`,$('#name-btn'));$('#save-name').onclick=()=>{myName=setReviewerName($('#review-name').value);paintName();closePop()}}
function shareMenu(){const url=new URL(location.href);url.searchParams.delete('key');pop(()=>`<h3>${tr('review.shareTitle')}</h3><input aria-label="${tr('review.publicLink')}" readonly value="${esc(url.href)}"><button id="copy-link" class="primary" style="margin-top:12px">${tr('review.copyLink')}</button>${state().isDocOwner?`<label>${tr('review.linkAccess')}<select id="access-level"><option value="view">${tr('review.accessView')}</option><option value="suggest">${tr('review.accessSuggest')}</option><option value="edit">${tr('review.accessEdit')}</option></select></label>`:''}<p id="share-note">${state().canEdit?tr('review.canEditHelp'):state().canSuggest?tr('review.canSuggestHelp'):tr('review.viewOnlyHelp')}</p>`,$('#share-btn'));$('#copy-link').onclick=async()=>{try{await navigator.clipboard.writeText(url.href);toast(()=>tr('review.copied'))}catch{$('#popover input').select();toast(()=>tr('review.copyManually'))}};if($('#access-level')){fetch(`/api/doc/${encodeURIComponent(docId)}`).then(r=>r.json()).then(d=>{$('#access-level')&&($('#access-level').value=d.access)});$('#access-level').onchange=async e=>{try{await api(`/api/access/${encodeURIComponent(docId)}`,{level:e.target.value},'PUT');await refresh(true);toast(()=>tr('review.accessUpdated'))}catch(err){toast(()=>errorText(err))}}}}
async function showHistory(){
 closePop();const panel=$('#hs-versions');panel.classList.add('open');panel.innerHTML=`<button id="close-history" style="float:right">×</button><h3 data-i18n="review.history">${tr('review.history')}</h3><div id="history-records"><span data-i18n="review.loading">${tr('review.loading')}</span></div>`;bindShell(panel);$('#close-history').onclick=()=>panel.classList.remove('open');
 try{const data=await fetch(`/api/versions/${encodeURIComponent(docId)}`).then(r=>r.json());$('#history-records').innerHTML=(data.versions||[]).map(v=>`<div class="thread"><p class="version-time" data-ts="${esc(v.ts)}">${esc(date(v.ts))}</p><p${v.label?'':' data-i18n="review.sourceEdit"'}>${esc(v.label||tr('review.sourceEdit'))}</p><button data-i18n="review.viewVersion" data-preview-version="${v.id}">${tr('review.viewVersion')}</button>${state().isDocOwner?`<button data-i18n="review.restoreVersion" data-restore-version="${v.id}">${tr('review.restoreVersion')}</button>`:''}<pre id="version-${v.id}" style="white-space:pre-wrap;font-size:12px"></pre></div>`).join('')||`<p data-i18n="review.noHistory">${tr('review.noHistory')}</p>`;bindShell($('#history-records'))}catch{bind($('#history-records'),'review.historyFailed')}
}
let polling=false;
async function poll(){
 if(document.hidden||polling||localEditing()||selectionPress||selectionInfo()||busy||composing||editTimers.size||editInflight||root.contains(document.activeElement)&&['edit','suggest'].includes(mode))return;
 polling=true;
 try{const r=await fetch(`/api/doc/${encodeURIComponent(docId)}`);if(!r.ok)return;const d=await r.json();if(document.hidden||localEditing()||root.contains(document.activeElement)&&mode==='suggest')return;const changed=JSON.stringify(d.overlay||{})!==overlaySignature||d.canEdit!==state().canEdit||d.canSuggest!==state().canSuggest;await refresh(changed)}catch{}finally{polling=false}
}
async function loadedIdentity(){
 let id=state().docId||docId,title=(typeof state().baseHtml==='string'?new DOMParser().parseFromString(state().baseHtml,'text/html').title:'')||root.querySelector('h1')?.textContent?.trim()||id;
 try{const r=await fetch(`/api/doc-meta/${encodeURIComponent(id)}`,{signal:AbortSignal.timeout(5000)});if(r.ok){const m=await r.json();if(typeof m.id==='string'&&m.id===id&&typeof m.title==='string')title=m.title||title}}catch{}
 try{rememberDoc({id,title})}catch{}
 return id;
}
async function main(){
 $('#viewer-home').onclick=e=>{e.preventDefault();requestLeave('home')};
 $('#leave-stay').onclick=stayHere;$('#leave-discard').onclick=()=>finishLeave(false);$('#leave-save').onclick=()=>finishLeave(true);
 $('#composer').addEventListener('cancel',e=>{e.preventDefault();closeComposer()});
 let composerOutside=false;
 const outsideComposer=e=>{const r=$('#composer').getBoundingClientRect();return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom};
 $('#composer').addEventListener('pointerdown',e=>{composerOutside=outsideComposer(e)});
 $('#composer').addEventListener('pointerup',e=>{if(composerOutside&&outsideComposer(e))closeComposer();composerOutside=false});
 $('#leave-dialog').addEventListener('cancel',e=>{e.preventDefault();stayHere()});
 // Standing help belongs in the existing help menu, not the discussion viewport.
 $('.discussion>.discussion-note')?.remove();
 // Reuse the full list and its filters inside the existing rail, not a second canvas.
 $('.view-switch')?.remove();
 const list=$('#annotation-list');$('#discussion').append(list);
 list.querySelector('.list-heading')?.remove();list.querySelector('.discussion-note')?.remove();
 const listButton=document.createElement('button');listButton.type='button';listButton.dataset.view='list';listButton.id='discussion-list-toggle';bind(listButton,'review.list');bind(listButton,'review.filterList',{},'title');listButton.setAttribute('aria-controls','annotation-list');
 const back=document.createElement('button');back.type='button';back.dataset.view='article';back.id='discussion-thread-toggle';bind(back,'review.discussion');bind(back,'review.backDiscussion',{},'title');back.setAttribute('aria-controls','threads');
 $('.discussion-head').insertBefore(back,$('.close-drawer'));$('.discussion-head').insertBefore(listButton,back);setView('article');
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
 window.addEventListener('resize',sizePop);window.visualViewport?.addEventListener('resize',sizePop);window.visualViewport?.addEventListener('scroll',sizePop);window.visualViewport?.addEventListener('resize',syncSelectionViewport);window.visualViewport?.addEventListener('scroll',syncSelectionViewport);syncSelectionViewport();
 const dock=$('.dock');
 const syncDock=()=>document.documentElement.style.setProperty('--hs-dock-h',dock.getBoundingClientRect().height+'px');
 new ResizeObserver(syncDock).observe(dock);syncDock();
 if(!docId){bind(root,'review.chooseDoc');return}
 try{if(!await bridge.init(docId))return;const canonicalId=await loadedIdentity();captureClean();buildToc();paintName();picker=elementReview({root,hash:sha256hex,enabled:()=>mode==='suggest'&&!draft&&!state().interactive&&!staticPreview?.active,onPick:t=>pickTarget(t),onThread:openThreadChoices,onText:captureSelection,onCancel:()=>{if($('#composer').hidden){dismissedSelection=selectionStamp();clearSelection()}}});applyMode();await refresh();staticPreview=state().interactive?null:createStaticPreview({docId,bridge,root,onMessage:staticMessage,getMode:()=>mode});reading=initReading({docId:canonicalId,root,article:$('#article'),main:$('.main'),staticPreview,interactive:state().interactive,frame:state().frame});initPreview({docId,bridge,staticPreview});status(()=>tr('review.connected'))}
 catch(e){status(()=>tr('review.loadFailed',{reason:errorText(e)}),'error');return}
 $('#nav-toggle').onclick=()=>toggleNav();$('#nav-close').onclick=()=>{toggleNav(false);closeNav()};$('#nav-shade').onclick=closeNav;
 $$('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));$$('[data-mode]').forEach(b=>b.onclick=()=>changeMode(b.dataset.mode));$$('.show-discussion,.comment-toggle').forEach(b=>b.onclick=toggleDiscussion);$('.close-drawer').onclick=closeDiscussion;
 $$('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;$$('[data-filter]').forEach(x=>x.classList.toggle('selected',x===b));renderThreads()});
 $$('[data-status]').forEach(b=>b.onclick=()=>{listStatus=b.dataset.status;$$('[data-status]').forEach(x=>x.classList.toggle('selected',x===b));renderList()});
 $$('[data-type]').forEach(b=>b.onclick=()=>{listType=b.dataset.type;$$('[data-type]').forEach(x=>x.classList.toggle('selected',x===b));renderList()});
 $('#list-records').onclick=e=>{const reopen=e.target.closest('[data-list-reopen]')?.dataset.listReopen;if(reopen){resolveComment(reopen,'reopen');return}const id=e.target.closest('[data-record]')?.dataset.record;if(id)locate(id)};
 $('#threads').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.staleResolve)resolveComment(b.dataset.staleResolve,'resolve-stale');if(b.dataset.accept)decide(b.dataset.accept,'accept');if(b.dataset.reject)decide(b.dataset.reject,'reject');if(b.dataset.resolve)resolveComment(b.dataset.resolve,'reject');if(b.dataset.reopen)resolveComment(b.dataset.reopen,'reopen');if(b.dataset.locate)locate(b.dataset.locate,false);if(b.dataset.reply)showComposer(b.dataset.reply)};
 $('#article').addEventListener('click',e=>{const el=e.target.closest('[data-thread],[data-review-block-thread]');if(el&&(mode==='read'||el.contentEditable==='false')){openDiscussion(el.dataset.thread||el.dataset.reviewBlockThread);return}const image=e.target.closest('[data-hs-comment-anchor]');if(image&&mode==='suggest'&&state().canSuggest){selected={anchor:image.dataset.hsCommentAnchor,quote:image.getAttribute('alt')||tr('review.nontext'),baseText:''};showComposer();return}
  // Only dismiss existing discussions. Selection, editing and composer drafts
  // keep their current cancellation semantics; never consume the article tap.
  if(innerWidth<=1100&&mode==='read'&&!localEditing()&&$('#composer').hidden&&getSelection()?.isCollapsed&&!e.target.closest('a,button,input,textarea,select,[contenteditable="true"]'))closeDiscussion();
 });
 document.addEventListener('review-frame-comment',e=>pickTarget(e.detail,state().frame));
 document.addEventListener('review-frame-thread',e=>openThreadChoices(e.detail.filter(id=>typeof id==='string')));
 document.addEventListener('review-target-clear',()=>{if($('#composer').hidden&&!selectionPress)clearSelection()});
 document.addEventListener('review-frame-missing',e=>{missingTarget(e.detail.anchor)});
 document.addEventListener('selectionchange',captureSelection);
 document.addEventListener('preview-change',()=>{marks.sync(staticPreview?.active?[]:commentGroups(),phone.matches);staticPreview?.send({type:'comment-groups',groups:commentGroups(),mobile:phone.matches})});
 window.addEventListener('resize',()=>{marks.sync(staticPreview?.active?[]:commentGroups(),phone.matches);staticPreview?.send({type:'comment-groups',groups:commentGroups(),mobile:phone.matches})});
 document.addEventListener('preview-geometry',()=>{positionDraft();if(staticPreview?.active)staticPreview.send({type:'measure-selection'})});
 for(const button of [$('#selection-action'),$('#mobile-add-comment')]){button.onpointerdown=armSelection;button.onpointercancel=()=>{selectionPress=null;selectionCapture=null;captureSelection()};button.onclick=()=>showComposer()}
 $('#target-parent').innerHTML=icon('chevronDown',{size:16})+'<span></span>';bind($('#target-parent span'),'review.parent');$('#selection-action').innerHTML=icon('message',{size:16})+'<span></span>';bind($('#selection-action span'),'review.writeComment');
 $('#target-parent').onclick=()=>navigateTarget('parent');
 $('#close-selection').onpointerdown=e=>e.preventDefault();$('#close-selection').onclick=()=>dismissTarget(true);
 // Bubble-phase shell blank only. Frame blanks arrive through their existing
 // source/token/origin-validated targetCleared routes, never raw coordinates.
 $('#article').addEventListener('click',e=>{if([$('#article'),root].includes(e.target))dismissTarget()});
 for(const b of [$('#selection-suggest')]){b.onpointerdown=armSelection;b.onclick=()=>showComposer(null,'rewrite')}
 $('#cancel-selection').onclick=()=>{changeMode('read');clearSelection(true);picker?.clear();staticPreview?.send({type:'clearTarget'});state().frame?.contentWindow?.postMessage({type:'clearTarget'},'*')};$('#close-composer').onclick=closeComposer;phone.addEventListener('change',captureSelection);$('#cancel-comment').onclick=closeComposer;$('#shade').onclick=closeComposer;$('#send-comment').onclick=sendComment;
 root.addEventListener('beforeinput',beginInput);root.addEventListener('input',handleInput);root.addEventListener('compositionstart',e=>{beginInput(e);composing=true});root.addEventListener('compositionend',e=>{composing=false;handleInput(e)});
 root.addEventListener('paste',e=>{if(e.target.closest?.('[data-inline-editor]'))return;if(mode==='read'||state().interactive||reloading)return;e.preventDefault();const text=e.clipboardData.getData('text/plain');if(/[\r\n]/.test(text)){toast(()=>tr('review.pasteParagraph'));return}let blocked=false;beginInput({target:e.target,inputType:'insertText',preventDefault(){blocked=true}});if(blocked)return;document.execCommand('insertText',false,text);handleInput(e)});
 // In edit mode decorate() already restores accepted HTML; never reset a live edit buffer on refocus.
 root.addEventListener('focusout',e=>{const el=e.target.closest('[data-hs-anchor]'),b=el&&editBuffers.get(el.dataset.hsAnchor);if(mode==='edit'&&el&&b&&b.seq>b.saved)saveEdit(el)});
 $('#submit-draft').onclick=submitDraft;$('#cancel-draft').onclick=cancelDraft;
 $('#name-btn').onclick=nameMenu;$('#share-btn').onclick=shareMenu;$('#more-btn').onclick=()=>{pop(()=>`<h3>${tr('review.options')}</h3>`+ (state().canEdit?'<button id="direct-edit-menu">'+(mode==='edit'?tr('review.exitEdit'):tr('review.editSource'))+'</button>':'')+`<button id="history-menu">${tr('review.history')}</button><button id="export-menu">${tr('review.export')}</button><button id="help-menu">${tr('review.help')}</button>`,$('#more-btn'));if($('#direct-edit-menu'))$('#direct-edit-menu').onclick=()=>{changeMode(mode==='edit'?'read':'edit');closePop();status(()=>mode==='edit'?tr('review.editStatus'):tr('review.backBrowse'))};$('#history-menu').onclick=showHistory;$('#export-menu').onclick=async()=>{if(draft||editTimers.size||editInflight)return toast(()=>tr('review.finishExport'));closePop();await bridge.exportHtml()};$('#help-menu').onclick=()=>{toast(()=>tr('review.helpText'));closePop()}};
 $('#hs-versions').onclick=async e=>{const b=e.target.closest('button');if(b?.dataset.previewVersion){const r=await fetch(`/api/version/${encodeURIComponent(docId)}/${b.dataset.previewVersion}`).then(r=>r.json());$('#version-'+b.dataset.previewVersion).textContent=JSON.stringify(r.overlay,null,2)}if(b?.dataset.restoreVersion){if(draft||!confirm(tr('review.restoreConfirm')))return;try{await api(`/api/restore/${encodeURIComponent(docId)}`,{versionId:Number(b.dataset.restoreVersion)});await refresh(true);showHistory()}catch(err){toast(()=>errorText(err))}}};
 document.addEventListener('pointerdown',e=>{if(e.target.closest('[data-locale-select]'))return;if(!e.target.closest('#popover,#name-btn,#share-btn,#more-btn'))closePop()});
 document.addEventListener('keydown',e=>{if($('#leave-dialog').open){if(e.key==='Escape'){e.preventDefault();stayHere()}return}if(!$('#composer').hidden)return;if(e.key==='Escape'){if(!$('#popover').hidden){e.preventDefault();closePop(true);return}if(!$('#selection-context').hidden&&dismissTarget(true)){e.preventDefault();return}picker?.clear();staticPreview?.send({type:'clearTarget'});state().frame?.contentWindow?.postMessage({type:'clearTarget'},'*');if(draft)cancelDraft();else{closeComposer();closeDiscussion();closeNav();closePop();$('#hs-versions').classList.remove('open')}}if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&draft){e.preventDefault();submitDraft()}});
 window.addEventListener('beforeunload',e=>{if(unsavedDrafts()){e.preventDefault();e.returnValue=tr('review.unsaved')}});
 syncDiscussion();matchMedia('(max-width:1100px)').addEventListener('change',syncDiscussion);
 if(innerWidth<=1100)$('#nav-toggle').setAttribute('aria-expanded','false');setInterval(poll,5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll()});
}

// Reconcile ONLY explicitly owned review-card/popover chrome. No imported tree,
// source iframe, composer value or editable node is visited by this function.
function patchShell(target,html){
 const template=document.createElement('template');template.innerHTML=html;
 function patch(old,next){
  if(old.nodeType===3&&next.nodeType===3){if(old.data!==next.data)old.data=next.data;return}
  if(old.nodeType!==next.nodeType||old.nodeName!==next.nodeName)return;
  if(old.nodeType!==1&&old.nodeType!==11)return;
  if(old.nodeType===1){for(const attr of ['aria-label','title','placeholder'])if(next.hasAttribute(attr))old.setAttribute(attr,next.getAttribute(attr));}
  // Locale-only renders have identical structure; fail closed on a record race.
  if(old.childNodes.length!==next.childNodes.length)return;
  for(let i=0;i<old.childNodes.length;i++)patch(old.childNodes[i],next.childNodes[i]);
 }
 if(target.childNodes.length===template.content.childNodes.length)for(let i=0;i<target.childNodes.length;i++)patch(target.childNodes[i],template.content.childNodes[i]);
}
function paintViewerLocale(){
 if(statusCopy)$('#hs-status .txt').textContent=statusCopy();
 if(toastCopy&&!$('#toast').hidden)$('#toast').textContent=toastCopy();
 if(popCopy&&!$('#popover').hidden)patchShell($('#popover'),popCopy());
 for(const n of $$('#hs-versions .version-time'))n.textContent=date(n.dataset.ts);
 const scope=elementScope(selected),reason=scope?rewriteReason(scope):null;if(selected){const note=$('#rewrite-reason');if(note)note.textContent=reason?.text||reason||'';$('#selection-suggest').title=reason?.text||reason||tr('review.inlineHint');$('#mobile-selection [role="status"]').textContent=reason?.text||reason||tr(selected.element?'review.selectedElement':'review.selectedText');}
 renderList(true,true);renderThreads(true,true);
 syncDiscussion();
 $('#nav-toggle').setAttribute('aria-label',tr($('#nav-toggle').getAttribute('aria-expanded')==='true'?'review.collapseNav':'review.expandNav'));
 for(const el of root.querySelectorAll('[data-hs-group]'))if(mode==='suggest')el.title=tr('review.groupRevisionHelp');
 inlineEditor.locale?.();marks.locale?.();
 staticPreview?.send({type:'locale',locale:locale.language});
 if(state().interactive)state().frame?.contentWindow?.postMessage({type:'locale',locale:locale.language},'*');
}
bindShell(document);
$('.topbar').insertBefore(languageSelect(),$('.header-tools'));
$('#composer').insertBefore(languageSelect(),$('#composer-title'));
$('#leave-dialog').prepend(languageSelect());
onLocaleChange(paintViewerLocale);

main().then(()=>installVersionNavigation({document:state().docId,locate(anchor){
 if(draft||!$('#composer').hidden)return;
 if(state().interactive)state().frame?.contentWindow?.postMessage({type:'flashComment',anchor,highlight:false},'*');
 else if(staticPreview?.active)staticPreview.send({type:'locate',anchor,id:'',highlight:false});
 else getBlock(anchor)?.scrollIntoView({block:'center'});
}}).catch(()=>{}));
