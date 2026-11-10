import {icon} from './icons.js';
import {elementReview} from './element-review.js';
import {sha256hex} from './anchoring.js';
import {reviewBridge as bridge} from './viewer.js';
import {reviewerName,setReviewerName} from './identity.js';
import {textOf,rangeAt,difference,locateRecord,singleBlockRange} from './review-ranges.js';
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
function pickTarget(t,frame=null){if(mode!=='suggest'||!state().canSuggest||!$('#composer').hidden||draft)return;let rect=t.rect;if(frame&&rect){const b=frame.getBoundingClientRect(),sx=b.width/frame.offsetWidth,sy=b.height/frame.offsetHeight;rect={left:b.left+rect.left*sx,top:b.top+rect.top*sy}}selected={anchor:t.anchor,quote:t.quote||t.snippet,baseText:'',element:!t.isText,textAnchor:t.textAnchor,tag:t.tag,context:t.context,parent:t.parent,child:t.child,rect};selectionUI(selected)}
function navigateTarget(direction){if(!$('#composer').hidden||draft)return;if(state().interactive)state().frame?.contentWindow.postMessage({type:'targetNavigate',direction},'*');else if(staticPreview?.active)staticPreview.send({type:'targetNavigate',direction});else picker?.navigate(direction)}
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
 if(!state().canSuggest)return '当前链接没有建议权限';
 if(state().interactive)return '交互页面仅支持批注，不支持静态原位修订';
 if(!s||s.element||!Number.isInteger(s.rangeStart))return '请在单个正文段落内选择文字；跨段或元素仍可写批注';
 const c=clean.get(s.anchor),el=getBlock(s.anchor);if(!c||!el||el.hasAttribute('data-hs-group'))return '此分组包含结构内容，仅支持批注；请选普通单段正文';
 const doc=new DOMParser().parseFromString(c.html,'text/html');
 if(doc.body.querySelector('br,img,svg,math,input,textarea,select,button,table,ul,ol,li,iframe,[contenteditable]'))return '此段包含换行、控件或嵌套结构，仅支持批注';
 if(c.text!==s.baseText||c.text.slice(s.rangeStart,s.rangeEnd)!==s.quote)return '原文已变化，请重新选择；不会移到同名文字';
 const overlap=records.find(r=>{if(r.anchor!==s.anchor||r.kind!=='rewrite'||r.status!=='open')return false;const loc=locateRecord(r,c.text,decode);return loc.stale||loc.fallback||rangesConflict({start:s.rangeStart,end:s.rangeEnd},loc)});
 return overlap?{id:overlap.id,text:'此处已有修订；请先查看并处理，再修改整个元素'}:null;
}
function rewriteAllowed(s){return !rewriteReason(s)}
const inlineStyle=document.createElement('style');inlineStyle.textContent=inlineDraftCSS;document.head.append(inlineStyle);
function draftChanged(m){if(!draft)return;draft.body=m.body;composing=!!m.composing;draft.rect=m.rect;positionDraft();status('原位建议草稿 · 尚未提交','dirty')}
const inlineEditor=inlineDraftController({doc:document,onChange:draftChanged,onKey:k=>k==='cancel'?cancelDraft():submitDraft()});
function positionDraft(){if(!draft)return;const actions=$('#draft-actions');if(phone.matches){actions.style.left='';actions.style.top='';return}let r=draft.rect;if(!r)return;if(staticPreview?.active){const b=staticPreview.frame.getBoundingClientRect(),scale=b.width/staticPreview.frame.offsetWidth;r={left:b.left+r.left*scale,top:b.top+(r.top+r.height)*scale}}else r={left:r.left,top:r.top+r.height};actions.style.left=Math.max(12,Math.min(innerWidth-300,r.left))+'px';actions.style.top=Math.max(75,Math.min(innerHeight-90,r.top+8))+'px'}
function startInline(){const s=elementScope(selected);if(!s)return toast('请选择可修改的单个正文元素；拖选文字仅支持写批注');const reason=rewriteReason(s);if(reason){if(reason.id)openDiscussion(reason.id);return toast(reason.text||reason)}draft={...s,body:s.quote,requestId:crypto.randomUUID?.()||'inline'+Date.now()};selectionUI(null);$('#draft-actions').hidden=false;picker?.clear();if(staticPreview?.active)staticPreview.send({type:'inline-start',anchor:s.anchor,start:s.rangeStart,end:s.rangeEnd,requestId:draft.requestId,html:clean.get(s.anchor).html});else {getBlock(s.anchor).innerHTML=clean.get(s.anchor).html;inlineEditor.start(getBlock(s.anchor),s.rangeStart,s.rangeEnd)}status('原位建议草稿 · 尚未提交','dirty')}
function staticSelection(m){
 const s=m.selection,c=clean.get(m.anchor),r=s?.rect,grouped=getBlock(m.anchor)?.hasAttribute('data-hs-group');
 if(!s||!c||typeof s.quote!=='string'||s.quote.length>100000||!Number.isInteger(s.rangeStart)||!Number.isInteger(s.rangeEnd)||s.rangeStart<0||s.rangeEnd<s.rangeStart||!grouped&&c.text.slice(s.rangeStart,s.rangeEnd)!==s.quote||!r||!['left','top','width','height'].every(k=>Number.isFinite(r[k])&&Math.abs(r[k])<100000))return null;
 const frame=staticPreview.frame,box=frame.getBoundingClientRect(),sx=box.width/frame.offsetWidth,sy=box.height/frame.offsetHeight;
 const result={anchor:m.anchor,baseText:c.text,quote:s.quote,rangeStart:s.rangeStart,rangeEnd:s.rangeEnd,rect:{left:box.left+(r.left+frame.clientLeft)*sx,top:box.top+(r.top+frame.clientTop)*sy}};
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
 if(m.type==='located'&&m.rect&&['left','top','width','height'].every(k=>Number.isFinite(m.rect[k])&&Math.abs(m.rect[k])<100000)){document.dispatchEvent(new CustomEvent('preview-reveal',{detail:{frame:staticPreview.frame,rect:m.rect}}));return}
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
 else if(m.type==='comment'&&mode==='suggest'&&state().canSuggest){const el=getBlock(m.anchor);selected={anchor:m.anchor,quote:el?.getAttribute('alt')||'非文本元素',baseText:''};showComposer()}
 else if(m.type==='key'&&draft){if(m.key==='Escape')cancelDraft();else if(['Enter','insertParagraph','insertLineBreak'].includes(m.key))submitDraft();staticPreview.sync()}
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
 if(draft){toast('请先提交或取消当前段落草稿');return}
 const list=next==='list';$('#annotation-list').hidden=!list;$('#threads').hidden=list;$('.discussion>.filters').hidden=list;
 document.body.classList.remove('list-view');
 $$('[data-view]').forEach(b=>{b.classList.toggle('selected',b.dataset.view===next);b.setAttribute('aria-pressed',String(b.dataset.view===next))});
 if(list){document.body.classList.remove('drawer-closed');document.body.classList.add('drawer-open');renderList()}syncDiscussion();
}
function closeNav(){document.body.classList.remove('nav-open');$('#nav-shade').hidden=true;if(innerWidth<=1100)$('#nav-toggle').setAttribute('aria-expanded','false')}
function toggleNav(force){
 if(innerWidth>1100){document.body.classList.toggle('nav-collapsed',force===undefined?!document.body.classList.contains('nav-collapsed'):!force);$('#nav-toggle').setAttribute('aria-expanded',String(!document.body.classList.contains('nav-collapsed')))}
 else{const open=force??!document.body.classList.contains('nav-open');document.body.classList.toggle('nav-open',open);$('#nav-shade').hidden=!open;$('#nav-toggle').setAttribute('aria-expanded',String(open))}
 $('#nav-toggle').setAttribute('aria-label',$('#nav-toggle').getAttribute('aria-expanded')==='true'?'收起文稿导航':'展开文稿导航');
}
function discussionOpen(){return getComputedStyle($('#discussion')).display!=='none'}
function syncDiscussion(){const open=discussionOpen();$$('.show-discussion,.comment-toggle').forEach(b=>{b.setAttribute('aria-expanded',String(open));b.setAttribute('aria-controls','discussion');b.setAttribute('aria-label',open?'收起批注栏':'打开批注栏');b.classList.toggle('selected',open)})}
function toggleDiscussion(){if(draft)return toast('请先提交或取消草稿');if(discussionOpen())closeDiscussion();else openDiscussion()}
function closeDiscussion(){document.body.classList.remove('drawer-open');document.body.classList.add('drawer-closed');syncDiscussion()}
// Scroll only the discussion viewport, never its article/window ancestors.
function scrollThread(id){
 const card=$('#thread-'+CSS.escape(id)), viewport=$('#threads');if(!card)return;
 const box=card.getBoundingClientRect(), view=viewport.getBoundingClientRect();
 if(box.top<view.top||box.bottom>view.bottom)viewport.scrollTop+=box.top-view.top;
}
function openDiscussion(id){dismissTarget();clearSelection();if(draft)return toast('请先提交或取消草稿');setView('article');if(id){active=id;filter='all';$$('[data-filter]').forEach(b=>b.classList.toggle('selected',b.dataset.filter===filter))}document.body.classList.remove('drawer-closed');document.body.classList.add('drawer-open');syncDiscussion();renderThreads();if(id)requestAnimationFrame(()=>scrollThread(id))}
function openThreadChoices(ids){ids=[...new Set(ids)].filter(id=>records.some(r=>r.id===id));if(!ids.length)return;if(ids.length===1)return openDiscussion(ids[0]);openDiscussion();pop('<h3>此处的批注 · '+ids.length+'</h3>'+ids.map(id=>{const r=records.find(s=>s.id===id);return `<button data-choose-thread="${esc(id)}">${esc(decode(r.author))} · ${esc(decode(r.body).slice(0,75))}</button>`}).join(''));$('#popover').onclick=e=>{const id=e.target.closest('[data-choose-thread]')?.dataset.chooseThread;if(id){$('#popover').hidden=true;openDiscussion(id)}}}
const marks=annotationAffordances({doc:document,onOpen:openThreadChoices,resolveTarget:a=>a.startsWith('c2:')?picker?.resolve(a):null});
function commentGroups(){const groups=new Map();for(const r of records){if(r.kind!=='comment'||r.status!=='open'||locations.get(r.id)?.stale)continue;if(!groups.has(r.anchor))groups.set(r.anchor,[]);groups.get(r.anchor).push(r.id)}return [...groups].map(([anchor,ids])=>({anchor,ids}))}
function locate(id,open=true){
 const s=records.find(x=>x.id===id);if(!s)return;if(open)openDiscussion(id);else if(innerWidth<=1100)closeDiscussion();
 $$('.record-focus').forEach(n=>n.classList.remove('record-focus'));
 if(state().interactive){state().frame?.contentWindow?.postMessage({type:'flashComment',anchor:s.anchor,highlight:s.status==='open'},'*');return}
 if(staticPreview?.active){staticPreview.send({type:'locate',id,anchor:s.anchor,highlight:s.status==='open'});return}
 if(s.anchor?.startsWith('c2:')){picker?.reveal(s.anchor).then(el=>{if(el){el.scrollIntoView({block:'center'});picker.refresh()}else missingTarget(s.anchor)});return}
 const loc=locations.get(id);if(loc?.stale){toast(loc.reason);return}
 const el=root.querySelector(`[data-thread="${CSS.escape(id)}"]`)||getBlock(s.anchor?.startsWith('m:')?s.anchor.slice(2).split(',')[0]:s.anchor);
 if(el){if(s.status==='open')el.classList.add('record-focus');el.scrollIntoView({block:'center'});if(loc?.fallback)toast(loc.reason)}else toast('原段落已删除或无法定位；未改挂到其他位置');
}
function missingTarget(anchor){for(const r of records)if(r.anchor===anchor)locations.set(r.id,{stale:true,reason:'元素已变化、不存在或不唯一，无法安全定位；仍可阅读与回复'});render();toast('无法安全定位此元素；未改挂到其他位置')}
function statusText(s){return ({open:'未处理',accepted:'已处理 · 已接受',rejected:s.kind==='comment'?'已处理 · 已解决':'已处理 · 已拒绝',stale:'已处理 · 锚点失效'}[s.status]||s.status)}
function typeText(s){return s.kind==='comment'?'评论':'修改建议'}
function quoteHtml(s){return s.kind==='rewrite'?`<del style="color:#92584e">${esc(decode(s.quote))||'（无删除）'}</del> → <span style="color:#285d48">${esc(decode(s.body))||'（删除此处）'}</span>`:esc(decode(s.quote))}
function renderList(preserve=false){
 const matches=records.filter(t=>(listStatus==='all'||(listStatus==='open'?t.status==='open':t.status!=='open'))&&(listType==='all'||t.kind===(listType==='suggestion'?'rewrite':listType)));
 $('#list-summary').textContent=`显示 ${matches.length} 条 / 共 ${records.length} 条 · 未处理 ${records.filter(s=>s.status==='open').length} 条`;
 const viewport=$('#annotation-list'),scroll=viewport.scrollTop,container=$('#list-records');const html=matches.map(t=>`<section id="list-${esc(t.id)}" data-list-card="${esc(t.id)}"><button class="annotation-row" data-record="${esc(t.id)}"><span class="row-meta"><span class="avatar">${esc([...t.author||'访'][0])}</span><strong>${esc(t.author||'访客')}</strong><span class="row-type">${typeText(t)}</span><span class="status">${statusText(t)}</span></span><span class="row-quote">${esc(decode(t.quote))||'（插入位置）'}</span><span class="row-body">${t.kind==='comment'?esc(decode(t.body)):quoteHtml(t)}</span><span class="row-link">查看原文与讨论 ↗${t.replies?.length?' · '+t.replies.length+' 条回复':''}${locations.get(t.id)?.stale?' · 引用失效':''}</span></button><div class="row-action">${t.kind==='comment'&&t.status==='rejected'&&state().isDocOwner?`<button data-list-reopen="${esc(t.id)}" ${pendingComments.has(t.id)?'disabled aria-busy="true"':''}>重新打开</button>`:''}</div></section>`).join('')||'<div class="empty">没有符合筛选条件的批注。</div>';
 if(!preserve)container.innerHTML=html;else{const template=document.createElement('template');template.innerHTML=html;const wanted=new Set();for(const card of [...template.content.children]){wanted.add(card.id);const old=card.id&&document.getElementById(card.id);if(old){for(const selector of ['.status','.row-action']){const a=old.querySelector(selector),b=card.querySelector(selector);if(a&&b&&a.outerHTML!==b.outerHTML)a.replaceWith(b)}}else{let next=card.nextElementSibling;while(next&&!document.getElementById(next.id))next=next.nextElementSibling;container.insertBefore(card,next?document.getElementById(next.id):null)}}for(const n of [...container.children])if(!wanted.has(n.id))n.remove()}
 viewport.scrollTop=scroll;
}
function renderThreads(preserve=false){
 const items=records.filter(t=>filter==='all'||(filter==='done'?t.status!=='open':t.status==='open'));
 const viewport=$('#threads'), scroll=viewport.scrollTop;const html=items.map(t=>`<section class="thread ${active===t.id?'active':''} ${t.status!=='open'?'resolved':''}" id="thread-${esc(t.id)}" data-card="${esc(t.id)}"><div class="thread-top"><span class="avatar">${esc([...t.author||'访'][0])}</span><strong>${esc(t.author||'访客')}</strong><span class="time">${esc(new Date(t.created_at).toLocaleDateString('zh-CN'))}</span></div><span class="thread-type">${t.kind==='rewrite'?'↗':'●'} ${typeText(t)}${t.status!=='open'?' · '+statusText(t):''}</span><div class="quote">${quoteHtml(t)}</div><p>${t.kind==='comment'?esc(decode(t.body)):t.status==='open'?'已在正文原位提出修改，等待所有者确认。':statusText(t)}</p>${locations.get(t.id)?.stale?`<p class="stale">${esc(locations.get(t.id).reason)}</p>`:''}${(t.replies||[]).map(r=>`<div class="reply"><b>${esc(r.author)}</b><br>${esc(decode(r.body))}</div>`).join('')}${t.kind==='rewrite'&&t.status==='open'&&state().isDocOwner?`<div class="thread-actions"><button class="accept" ${locations.get(t.id)?.stale?'disabled title="原引用已失效，不能接受"':''} data-accept="${esc(t.id)}">✓ 接受修改</button><button data-reject="${esc(t.id)}">拒绝</button></div>`:''}<div class="thread-footer"><button data-locate="${esc(t.id)}">↗ 定位原文</button><span>${state().canSuggest?`<button data-reply="${esc(t.id)}">回复</button>`:''}${t.kind==='comment'&&t.status==='open'&&state().isDocOwner?`<button data-resolve="${esc(t.id)}" ${pendingComments.has(t.id)?'disabled aria-busy="true"':''}>解决 ✓</button>`:''}${t.kind==='comment'&&t.status==='rejected'&&state().isDocOwner?`<button data-reopen="${esc(t.id)}" ${pendingComments.has(t.id)?'disabled aria-busy="true"':''}>重新打开</button>`:''}</span></div></section>`).join('')||'<div class="empty">暂时没有符合筛选条件的讨论。<br>选中文字即可添加一条批注。</div>';
 // Keyed cards: preserve existing cards, expanded state, focus and local scroll.
 if(!preserve){viewport.innerHTML=html;viewport.scrollTop=scroll;return}
 const template=document.createElement('template');template.innerHTML=html;const wanted=new Set();
 for(const card of [...template.content.children]){const old=card.id&&document.getElementById(card.id);wanted.add(card.id);if(old){if(old.outerHTML!==card.outerHTML){old.className=card.className;for(const selector of ['.thread-type','.thread-footer','.thread-actions']){const next=card.querySelector(selector),prior=old.querySelector(selector);if(prior&&next)prior.replaceWith(next);else if(prior)prior.remove();else if(next)old.append(next)}}}else{let next=card.nextElementSibling;while(next&&!document.getElementById(next.id))next=next.nextElementSibling;viewport.insertBefore(card,next?document.getElementById(next.id):null)}}
 for(const card of [...viewport.children])if(!wanted.has(card.id))card.remove();viewport.scrollTop=scroll;
}
function render(preserve=false){const count=records.filter(t=>t.status==='open').length;$$('.total').forEach(n=>n.textContent=count);renderList(preserve);renderThreads(preserve)}
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
 }else if(s.kind==='comment'){span.tabIndex=0;span.setAttribute('role','button');span.setAttribute('aria-label','打开此处批注')}
 return true;
}
function decorate(){
 clearSelection();if(state().interactive){syncCommentState();return}restoreClean();locations=new Map();
 for(const s of records){
  if(s.anchor?.startsWith('m:')){const el=getBlock(s.anchor.slice(2).split(',')[0]);locations.set(s.id,el?{fallback:true,reason:'旧多段批注；定位首段'}:{stale:true,reason:'原段落无法定位'});continue}
  if(s.anchor?.startsWith('c2:')){locations.set(s.id,{fallback:true,reason:'元素批注'});continue}
  const el=getBlock(s.anchor), original=clean.get(s.anchor);
  if(!el){locations.set(s.id,{stale:true,reason:'原段落已删除或锚点失效，未改挂到其他位置'});continue}
  if(!original){locations.set(s.id,{fallback:true,reason:'非文本元素批注'});if(s.status==='open')el.dataset.reviewBlockThread=s.id;continue}
  const loc=el.hasAttribute('data-hs-group')?{fallback:true,reason:'分组富文本批注；定位原文分组'}:locateRecord(s,original.text,decode);locations.set(s.id,loc);
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
 const comments=records.filter(r=>r.kind==='comment').map(r=>({id:r.id,anchor:r.anchor,open:r.status==='open'&&mode!=='edit',...locations.get(r.id)}));
 marks.comments(comments,draft?.anchor);
 const groups=commentGroups();marks.sync(staticPreview?.active||state().interactive?[]:groups,phone.matches);
 staticPreview?.send({type:'comment-state',comments,groups,mobile:phone.matches});
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
 if(!current||current.kind!=='comment'||!state().isDocOwner||pendingComments.has(id)||reloading)return;
 if(action==='reopen'?current.status!=='rejected':current.status!=='open')return;
 const source=state().frame, anchorMap=state().anchorMap;pendingComments.add(id);commentVersion++;
 const buttons=()=>$$(`[data-resolve="${CSS.escape(id)}"],[data-reopen="${CSS.escape(id)}"],[data-list-reopen="${CSS.escape(id)}"]`);for(const button of buttons()){button.disabled=true;button.setAttribute('aria-busy','true')}
 try{
  const data=await api(`/api/suggest/${encodeURIComponent(docId)}/${encodeURIComponent(id)}/${action}`);
  if(state().frame!==source||state().anchorMap!==anchorMap||!records.some(r=>r.id===id))return;
  const s=data.suggestion;if(!s||s.id!==id||s.doc_id!==docId||s.kind!=='comment')throw Error('批注状态响应无效，请重试');
  updateComment(s);status(s.status==='open'?'批注已重新打开':'批注已解决');
 }catch(e){toast('批注未更新：'+e.message);status(e.message,'error')}
 finally{pendingComments.delete(id);commentVersion++;for(const b of buttons()){b.disabled=false;b.removeAttribute('aria-busy')}}
}
async function refresh(reload=false){
 if(refreshBusy||localEditing()||pendingComments.size)return;refreshBusy=true;const version=commentVersion;
 try{
  if(reload){reloading=true;root.inert=true;await bridge.reload();await staticPreview?.reconnect();captureClean();editBuffers.clear();buildToc()}
  const r=await fetch(`/api/suggestions/${encodeURIComponent(docId)}?status=all`);
  if(r.status===403){records=[];$('#threads').innerHTML='<div class="empty">当前链接仅允许阅读，不展示批注记录。</div>';return}
  if(!r.ok)throw Error('批注加载失败');const next=(await r.json()).suggestions||[];if(version!==commentVersion||pendingComments.size)return;const same=JSON.stringify(next)===JSON.stringify(records);const withoutStatus=rows=>JSON.stringify(rows.map(({status,...r})=>r));const statusOnly=withoutStatus(next)===withoutStatus(records);records=next;if(!localEditing()&&(!same||reload)){if(statusOnly&&!reload)syncCommentState();else decorate();render(statusOnly&&!reload)}
 }catch(e){status(e.message,'error')}finally{refreshBusy=false;reloading=false;root.inert=false}
}
function applyMode(){
 const caps=state();bridge.setMode(caps.interactive?(mode==='read'?'use':mode):'view');
 $$('[data-mode]').forEach(b=>{const m=b.dataset.mode;b.disabled=(m==='edit'&&!caps.canEdit)||(m==='suggest'&&!caps.canSuggest);b.classList.toggle('selected',m===mode);b.setAttribute('aria-pressed',String(m===mode));if(b.disabled)b.title=m==='edit'?'此链接没有直接编辑权限':'此链接不允许建议'});
 if(!caps.interactive)for(const [a,el] of caps.anchorMap){const locked=records.some(s=>s.anchor===a&&s.status==='open'&&s.kind==='rewrite');const grouped=el.hasAttribute('data-hs-group');el.contentEditable=String(mode==='edit'&&caps.canEdit);if(grouped&&mode==='suggest')el.title='分组富文本仅支持批注；请在普通单段正文中提出原位修改'}
 picker?.refresh();staticPreview?.sync();
}
function changeMode(next){if(!$('#composer').hidden)return toast('请先提交或取消批注草稿');if(editTimers.size||editInflight||[...editBuffers.values()].some(b=>b.seq>b.saved))return toast('正文仍在保存，请稍后切换模式');if(draft)return toast('请先提交或取消当前草稿');if(next==='edit'&&!state().canEdit||next==='suggest'&&!state().canSuggest)return;mode=next;decorate();applyMode();clearSelection()}
function buildToc(){
 const title=root.querySelector('h1')?.textContent?.trim()||docId;$('#hs-docname').textContent=title;document.title=title+' · Marginroom';
 $('#toc').innerHTML='';root.querySelectorAll('h1,h2,h3').forEach((h,i)=>{const b=document.createElement('button');b.className='sub';b.textContent=h.textContent.trim();b.onclick=()=>{setView('article');closeNav();if(staticPreview?.active&&h.dataset.hsAnchor)staticPreview.send({type:'locate',anchor:h.dataset.hsAnchor,id:''});else h.scrollIntoView({block:'start'})};$('#toc').append(b)});
}
function selectionInfo(){
 if(staticPreview?.active)return frameSelection;
 const sel=getSelection();if(!sel?.rangeCount||sel.isCollapsed)return null;
 const block=singleBlockRange(sel.getRangeAt(0));if(!block||!root.contains(block.el))return null;
 const {range:r,el}=block,node=r.startContainer.nodeType===1?r.startContainer:r.startContainer.parentElement;
 if(el.hasAttribute('data-hs-group'))return {anchor:el.dataset.hsAnchor,baseText:bridge.readText(el),quote:r.toString(),rect:r.getBoundingClientRect()};
 if(r.cloneContents().querySelector('[data-review-ins]')||node.closest('[data-review-ins]'))return null;
 const pre=document.createRange();pre.selectNodeContents(el);pre.setEnd(r.startContainer,r.startOffset);
 const start=textOf(pre.cloneContents(),'[data-review-ins],[data-review-point]'),quote=textOf(r.cloneContents(),'[data-review-ins],[data-review-point]');if(!quote.trim())return null;
 return {anchor:el.dataset.hsAnchor,baseText:clean.get(el.dataset.hsAnchor)?.text??el.textContent,quote,rangeStart:start.length,rangeEnd:start.length+quote.length,rect:r.getBoundingClientRect()};
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
 $('#selection-suggest').innerHTML=icon('edit',{size:16})+'<span>'+(overlap?'查看修订':'原位修改')+'</span>';
 $('#selection-suggest').title=reason?.text||reason||'在所选正文位置输入修改';
 let note=$('#rewrite-reason');if(!note){note=document.createElement('span');note.id='rewrite-reason';note.setAttribute('role','status');$('#selection-context').append(note)}note.textContent=reason?.text||reason||'';note.hidden=!reason;
 $('#target-label').textContent=s?.element?s.quote:'';$('#target-label').title=s?.element?(scope?.quote||s.context||s.quote):'';$('#target-tag').textContent=s?.tag||s?.quote?.split(/[ :]/)[0]||'';$('#target-heading').hidden=!available||!s.element;
 $('#target-navigation').hidden=!available||!s.element;
 $('#target-parent').disabled=!s?.parent;$('#target-child').disabled=!s?.child;
 $('#mobile-selection [role="status"]').textContent=reason?.text||reason||(s?.element?'已选元素':'已选文字');
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
 if(!id&&staticPreview?.active&&!selected?.element){openingComposer=true;try{const m=await (selectionCapture||staticPreview.captureSelection());if(m.reason==='invalid'){clearSelection();return}if(m.selection){const current=staticSelection(m);if(!current){clearSelection();return}selectionPress=current}}catch(e){toast(e.message);return}finally{openingComposer=false;selectionCapture=null}}
 if(!$('#composer').hidden||draft||busy)return;
 if(!id){selected=selectionPress||(selected?.element?selected:selectionInfo()||selected);if(!selected||(!state().interactive&&selected.rangeStart!=null&&!getBlock(selected.anchor)))return}
 if(kind==='rewrite'){if(!selected?.element)return;clearTimeout(selectionPressTimer);selectionPress=null;startInline();return}
 composeKind=kind;clearTimeout(selectionPressTimer);selectionPress=null;replyTo=id||null;showComposer.requestId=crypto.randomUUID?.()||'r'+Date.now();
 selectionUI(null);$('#composer-title').textContent=id?'回复讨论':kind==='rewrite'?'建议修改':'写批注';$('#selected-quote').textContent=id?decode(records.find(s=>s.id===id)?.quote):selected.quote;$('#comment-body').value='';$('#send-comment').textContent=id?'回复':kind==='rewrite'?'提交建议':'写批注';$('#composer').hidden=false;$('#shade').hidden=false;$('#comment-body').focus({preventScroll:true});$('#comment-body').scrollTop=0;
}
function unsavedEdits(){return editTimers.size>0||editInflight>0||[...editBuffers.values()].some(b=>b.seq>b.saved)}
function typedComment(){return !$('#composer').hidden&&$('#comment-body').value.length>0}
function unsavedDrafts(){return typedComment()||!!draft&&draft.body!==draft.quote||unsavedEdits()||composing}
let leaveIntent=null,leaveFocus=null,leaving=false;
function requestLeave(intent='home'){
 if(busy)return toast('正在提交，请等待完成');
 if(!unsavedDrafts()){if(intent==='home'){reading?.persist();location.assign('/')}else closeComposer(true);return}
 leaveIntent=intent;leaveFocus=document.activeElement;
 $('#leave-message').textContent=unsavedEdits()?'正文还有未保存的修改。可重试保存，或仅放弃尚未发送的修改；已经保存的正文不会撤回。':'草稿尚未提交。你可以继续编辑、提交后离开，或明确放弃草稿。';
 $('#leave-discard').textContent=intent==='home'?'放弃并返回首页':'放弃草稿并关闭';
 $('#leave-save').textContent=intent==='home'?'提交 / 保存后返回首页':'提交并关闭';
 $('#leave-dialog').showModal();
}
function stayHere(){if(leaving)return;$('#leave-dialog').close();leaveIntent=null;leaveFocus?.focus({preventScroll:true})}
async function finishLeave(save){
 if(leaving||busy)return;
 if(editInflight&&!save){$('#leave-message').textContent='正文正在保存；请稍后再选择。已发送的修改不能在此撤回。';return}
 if(composing)return toast('请先完成文字输入，再选择离开');
 leaving=true;for(const b of $('#leave-dialog').querySelectorAll('button'))b.disabled=true;
 try{
  if(save){
   if(typedComment())await sendComment();
   if(draft&&draft.body!==draft.quote)await submitDraft();
   // Flush debounce timers and retry failed buffers, without dropping newer text.
   for(const [a,b] of editBuffers)if(b.seq>b.saved){const el=getBlock(a);if(el)await saveEdit(el)}
   if(unsavedDrafts()){$('#leave-message').textContent='仍有内容未保存。提交失败时草稿仍保留；请继续编辑或重试保存。';return}
  }else if(leaveIntent==='home'){for(const t of editTimers.values())clearTimeout(t);editTimers.clear();editBuffers.clear()}
  const intent=leaveIntent;$('#leave-dialog').close();leaveIntent=null;
  if(intent==='home'){reading?.persist();if(draft)cancelDraft();closeComposer(true);location.assign('/')}
  else{if(draft)cancelDraft();closeComposer(true)}
 }finally{leaving=false;for(const b of $('#leave-dialog').querySelectorAll('button'))b.disabled=false}
}
function closeComposer(force=false){if(busy)return;if(force!==true&&typedComment()){requestLeave('composer');return}$('#composer').hidden=true;$('#comment-body').value='';$('#shade').hidden=true;replyTo=null;clearSelection(true)}
async function sendComment(){
 const body=$('#comment-body').value.trim();if((!body&&composeKind!=='rewrite')||busy)return;busy=true;$('#send-comment').disabled=true;
 try{let id=replyTo;
  if(id)await api(`/api/suggest/${encodeURIComponent(docId)}/${encodeURIComponent(id)}/replies`,{body,author:myName,requestId:showComposer.requestId});
  else{const res=await api(`/api/suggest/${encodeURIComponent(docId)}`,{anchor:selected.anchor,quote:selected.quote,baseText:selected.baseText,rangeStart:selected.rangeStart,rangeEnd:selected.rangeEnd,body,kind:composeKind,author:myName,requestId:selected.requestId||(selected.requestId=crypto.randomUUID?.()||'c'+Date.now())});id=res.suggestion.id}
  busy=false;closeComposer(true);await refresh();openDiscussion(id);status('批注已保存');getSelection()?.removeAllRanges();
 }catch(e){toast(e.message);status('批注未提交，请重试','error')}finally{busy=false;$('#send-comment').disabled=false}
}

function cancelDraft(){if(!draft||busy)return;const saved=draft;inlineEditor.stop();staticPreview?.send({type:'inline-stop'});draft=null;composing=false;$('#draft-actions').hidden=true;decorate();if(staticPreview?.active)staticPreview.send({type:'restore-selection',anchor:saved.anchor,start:saved.rangeStart,end:saved.rangeEnd});else inlineEditor.restoreSelection(getBlock(saved.anchor),saved.rangeStart,saved.rangeEnd);status('已取消草稿')}
async function submitDraft(){
 if(!draft||busy||composing)return;const current=draft;if(current.quote===current.body){cancelDraft();return}
 busy=true;$('#submit-draft').disabled=true;
 try{
  // The editable scope is the whole element; persist only the changed range.
  const diff=difference(current.quote,current.body);
  const res=await api(`/api/suggest/${encodeURIComponent(docId)}`,{anchor:current.anchor,quote:diff.old,body:diff.next,kind:'rewrite',author:myName,baseText:current.baseText,rangeStart:current.rangeStart+diff.start,rangeEnd:current.rangeStart+diff.end,requestId:current.requestId});
  inlineEditor.stop();staticPreview?.send({type:'inline-stop'});draft=null;$('#draft-actions').hidden=true;await refresh();active=res.suggestion.id;render();status('建议已保存，等待确认');toast('建议已保存；原文尚未改变');
 }catch(e){toast(e.message);status('草稿未提交，可重试或取消','error')}finally{busy=false;$('#submit-draft').disabled=false}
}
function beginInput(e,sel=getSelection()){
 if(e.target.closest?.('[data-inline-editor]'))return;
 if(reloading){e.preventDefault();return}
 if(mode!=='edit'||state().interactive){e.preventDefault();return;}
 const el=e.target.closest?.('[data-hs-anchor]');if(!el)return;
 if(sel?.rangeCount){const r=sel.getRangeAt(0),block=singleBlockRange(r,el);if(!block){e.preventDefault();toast('原位修改限单个段落；跨段请选择分别处理');return}if(!el.contains(r.endContainer)){sel.removeAllRanges();sel.addRange(block.range)}}

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
async function loadedIdentity(){
 let id=state().docId||docId,title=(typeof state().baseHtml==='string'?new DOMParser().parseFromString(state().baseHtml,'text/html').title:'')||root.querySelector('h1')?.textContent?.trim()||id;
 try{const r=await fetch(`/api/doc-meta/${encodeURIComponent(id)}`,{signal:AbortSignal.timeout(5000)});if(r.ok){const m=await r.json();if(typeof m.id==='string'&&m.id===id&&typeof m.title==='string')title=m.title||title}}catch{}
 try{rememberDoc({id,title})}catch{}
 return id;
}
async function main(){
 $('#viewer-home').onclick=e=>{e.preventDefault();requestLeave('home')};
 $('#leave-stay').onclick=stayHere;$('#leave-discard').onclick=()=>finishLeave(false);$('#leave-save').onclick=()=>finishLeave(true);
 $('#leave-dialog').addEventListener('cancel',e=>{e.preventDefault();stayHere()});
 // Standing help belongs in the existing help menu, not the discussion viewport.
 $('.discussion>.discussion-note')?.remove();
 // Reuse the full list and its filters inside the existing rail, not a second canvas.
 $('.view-switch')?.remove();
 const list=$('#annotation-list');$('#discussion').append(list);
 list.querySelector('.list-heading')?.remove();list.querySelector('.discussion-note')?.remove();
 const listButton=document.createElement('button');listButton.type='button';listButton.dataset.view='list';listButton.id='discussion-list-toggle';listButton.textContent='列表';listButton.title='筛选全部批注';listButton.setAttribute('aria-controls','annotation-list');
 const back=document.createElement('button');back.type='button';back.dataset.view='article';back.id='discussion-thread-toggle';back.textContent='讨论';back.title='返回批注讨论';back.setAttribute('aria-controls','threads');
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
 window.visualViewport?.addEventListener('resize',syncSelectionViewport);window.visualViewport?.addEventListener('scroll',syncSelectionViewport);syncSelectionViewport();
 const dock=$('.dock');
 const syncDock=()=>document.documentElement.style.setProperty('--hs-dock-h',dock.getBoundingClientRect().height+'px');
 new ResizeObserver(syncDock).observe(dock);syncDock();
 if(!docId){root.textContent='请选择一份文稿。';return}
 try{if(!await bridge.init(docId))return;const canonicalId=await loadedIdentity();captureClean();buildToc();paintName();picker=elementReview({root,hash:sha256hex,enabled:()=>mode==='suggest'&&!draft&&!state().interactive&&!staticPreview?.active,onPick:t=>pickTarget(t),onThread:openThreadChoices,onText:captureSelection,onCancel:()=>{if($('#composer').hidden){dismissedSelection=selectionStamp();clearSelection()}}});applyMode();await refresh();staticPreview=state().interactive?null:createStaticPreview({docId,bridge,root,onMessage:staticMessage,getMode:()=>mode});reading=initReading({docId:canonicalId,root,article:$('#article'),main:$('.main'),staticPreview,interactive:state().interactive,frame:state().frame});initPreview({docId,bridge,staticPreview});status('已连接 · 数据已同步')}
 catch(e){status('加载失败：'+e.message,'error');return}
 $('#nav-toggle').onclick=()=>toggleNav();$('#nav-close').onclick=()=>{toggleNav(false);closeNav()};$('#nav-shade').onclick=closeNav;
 $$('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));$$('[data-mode]').forEach(b=>b.onclick=()=>changeMode(b.dataset.mode));$$('.show-discussion,.comment-toggle').forEach(b=>b.onclick=toggleDiscussion);$('.close-drawer').onclick=closeDiscussion;
 $$('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;$$('[data-filter]').forEach(x=>x.classList.toggle('selected',x===b));renderThreads()});
 $$('[data-status]').forEach(b=>b.onclick=()=>{listStatus=b.dataset.status;$$('[data-status]').forEach(x=>x.classList.toggle('selected',x===b));renderList()});
 $$('[data-type]').forEach(b=>b.onclick=()=>{listType=b.dataset.type;$$('[data-type]').forEach(x=>x.classList.toggle('selected',x===b));renderList()});
 $('#list-records').onclick=e=>{const reopen=e.target.closest('[data-list-reopen]')?.dataset.listReopen;if(reopen){resolveComment(reopen,'reopen');return}const id=e.target.closest('[data-record]')?.dataset.record;if(id)locate(id)};
 $('#threads').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.accept)decide(b.dataset.accept,'accept');if(b.dataset.reject)decide(b.dataset.reject,'reject');if(b.dataset.resolve)resolveComment(b.dataset.resolve,'reject');if(b.dataset.reopen)resolveComment(b.dataset.reopen,'reopen');if(b.dataset.locate)locate(b.dataset.locate,false);if(b.dataset.reply)showComposer(b.dataset.reply)};
 $('#article').addEventListener('click',e=>{const el=e.target.closest('[data-thread],[data-review-block-thread]');if(el&&(mode==='read'||el.contentEditable==='false')){openDiscussion(el.dataset.thread||el.dataset.reviewBlockThread);return}const image=e.target.closest('[data-hs-comment-anchor]');if(image&&mode==='suggest'&&state().canSuggest){selected={anchor:image.dataset.hsCommentAnchor,quote:image.getAttribute('alt')||'非文本元素',baseText:''};showComposer();return}
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
 $('#target-parent').innerHTML=icon('chevronDown',{size:16})+'<span>父元素</span>';$('#target-child').innerHTML=icon('chevronDown',{size:16})+'<span>子元素</span>';$('#selection-action').innerHTML=icon('message',{size:16})+'<span>写批注</span>';
 $('#target-parent').onclick=()=>navigateTarget('parent');$('#target-child').onclick=()=>navigateTarget('child');
 $('#close-selection').onpointerdown=e=>e.preventDefault();$('#close-selection').onclick=()=>dismissTarget(true);
 // Bubble-phase shell blank only. Frame blanks arrive through their existing
 // source/token/origin-validated targetCleared routes, never raw coordinates.
 $('#article').addEventListener('click',e=>{if([$('#article'),root].includes(e.target))dismissTarget()});
 for(const b of [$('#selection-suggest')]){b.onpointerdown=armSelection;b.onclick=()=>showComposer(null,'rewrite')}
 $('#cancel-selection').onclick=()=>{changeMode('read');clearSelection(true);picker?.clear();staticPreview?.send({type:'clearTarget'});state().frame?.contentWindow?.postMessage({type:'clearTarget'},'*')};$('#close-composer').onclick=closeComposer;phone.addEventListener('change',captureSelection);$('#cancel-comment').onclick=closeComposer;$('#shade').onclick=closeComposer;$('#send-comment').onclick=sendComment;
 root.addEventListener('beforeinput',beginInput);root.addEventListener('input',handleInput);root.addEventListener('compositionstart',e=>{beginInput(e);composing=true});root.addEventListener('compositionend',e=>{composing=false;handleInput(e)});
 root.addEventListener('paste',e=>{if(e.target.closest?.('[data-inline-editor]'))return;if(mode==='read'||state().interactive||reloading)return;e.preventDefault();const text=e.clipboardData.getData('text/plain');if(/[\r\n]/.test(text)){toast('原位修改限单段，请分段粘贴');return}let blocked=false;beginInput({target:e.target,inputType:'insertText',preventDefault(){blocked=true}});if(blocked)return;document.execCommand('insertText',false,text);handleInput(e)});
 // In edit mode decorate() already restores accepted HTML; never reset a live edit buffer on refocus.
 root.addEventListener('focusout',e=>{const el=e.target.closest('[data-hs-anchor]'),b=el&&editBuffers.get(el.dataset.hsAnchor);if(mode==='edit'&&el&&b&&b.seq>b.saved)saveEdit(el)});
 $('#submit-draft').onclick=submitDraft;$('#cancel-draft').onclick=cancelDraft;
 $('#name-btn').onclick=nameMenu;$('#share-btn').onclick=shareMenu;$('#more-btn').onclick=()=>{pop('<h3>文稿选项</h3>'+ (state().canEdit?'<button id="direct-edit-menu">'+(mode==='edit'?'退出原文编辑 · 返回浏览':'直接编辑原文')+'</button>':'')+'<button id="history-menu">版本历史</button><button id="export-menu">导出已接受的 HTML</button><button id="help-menu">审稿操作说明</button>');if($('#direct-edit-menu'))$('#direct-edit-menu').onclick=()=>{changeMode(mode==='edit'?'read':'edit');$('#popover').hidden=true;status(mode==='edit'?'直接编辑原文 · 菜单退出返回浏览':'已返回浏览')};$('#history-menu').onclick=showHistory;$('#export-menu').onclick=async()=>{if(draft||editTimers.size||editInflight)return toast('请先提交草稿并等待正文保存');$('#popover').hidden=true;await bridge.exportHtml()};$('#help-menu').onclick=()=>{toast('浏览时操作原页面；批注时点击元素，拖选文字仅写批注；点击正文元素后可原位修改其全部文字；Ctrl/⌘+Enter 或提交按钮保存，Esc取消草稿。已提交建议用接受/拒绝处理，跨段及分组富文本仅支持评论。');$('#popover').hidden=true}};
 $('#hs-versions').onclick=async e=>{const b=e.target.closest('button');if(b?.dataset.previewVersion){const r=await fetch(`/api/version/${encodeURIComponent(docId)}/${b.dataset.previewVersion}`).then(r=>r.json());$('#version-'+b.dataset.previewVersion).textContent=JSON.stringify(r.overlay,null,2)}if(b?.dataset.restoreVersion){if(draft||!confirm('恢复此版本？当前正文会保存为可追溯的历史。'))return;try{await api(`/api/restore/${encodeURIComponent(docId)}`,{versionId:Number(b.dataset.restoreVersion)});await refresh(true);showHistory()}catch(err){toast(err.message)}}};
 document.addEventListener('pointerdown',e=>{if(!e.target.closest('#popover,#name-btn,#share-btn,#more-btn'))$('#popover').hidden=true});
 document.addEventListener('keydown',e=>{if($('#leave-dialog').open){if(e.key==='Escape'){e.preventDefault();stayHere()}return}if(e.key==='Escape'){if(!$('#selection-context').hidden&&dismissTarget(true)){e.preventDefault();return}picker?.clear();staticPreview?.send({type:'clearTarget'});state().frame?.contentWindow?.postMessage({type:'clearTarget'},'*');if(draft)cancelDraft();else{closeComposer();closeDiscussion();closeNav();$('#popover').hidden=true;$('#hs-versions').classList.remove('open')}}if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&draft){e.preventDefault();submitDraft()}});
 window.addEventListener('beforeunload',e=>{if(unsavedDrafts()){e.preventDefault();e.returnValue='尚有未提交修改'}});
 syncDiscussion();matchMedia('(max-width:1100px)').addEventListener('change',syncDiscussion);
 if(innerWidth<=1100)$('#nav-toggle').setAttribute('aria-expanded','false');setInterval(poll,5000);
}
main();
