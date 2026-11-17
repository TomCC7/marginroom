import {t,bind,unbind,pruneBindings,bindShell,onLocaleChange,languageSelect,date} from './i18n.js';
import { referencedImages } from './assets.js';
import { readHistory, removeRecent, clearRecent, loadHomeState, saveHomeState, HISTORY_KEY } from './entry-history.js';

const copy=(key,params={})=>({key,params,toString(){return t(key,params)}});
function put(node,value,attribute='textContent'){if(value?.key)bind(node,value.key,value.params,attribute);else{unbind(node,attribute);if(attribute==='textContent')node.textContent=value;else node.setAttribute(attribute,value)}}
function failure(value){return Object.assign(new Error(String(value)),{copy:value})}
const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Bootstrap owner key stays in memory only; never include it in a viewer/share URL.
const key = new URLSearchParams(location.search).get('key');
if (new URLSearchParams(location.search).has('key')) {
  const url = new URL(location.href);
  url.searchParams.delete('key');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}
const withKey = url => key ? `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}` : url;
const viewerUrl = id => `/viewer.html?doc=${encodeURIComponent(id)}`;
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[A-Za-z0-9._-]+$/.test(id) && id !== '.' && id !== '..' && !/\.raw$/i.test(id);
async function importPolicy(){const j=await request('/api/instance');if(!j.importLimits)throw Error('missing_import_policy');return j.importLimits;}
const state = loadHomeState();
let view = state.view, query = state.query, docs = [], loading = false, loadError = false, generation = 0;
let whoami = { isOwner: false, docLimit: 1 };
let opener = null, closeAction = null, busy = false, importDraft = null;
const knownIds = new Set();
const modal = $('#modal');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) put(node,text);
  return node;
}
function button(text, run, cls = '') {
  const node = el('button', cls, text);
  node.type = 'button';
  node.onclick = run;
  return node;
}
function toast(text) {
  put($('#toast'),text);
  $('#toast').hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
}
function save() { saveHomeState({ view, query, scrollY: window.scrollY }); }
async function request(url, options) {
  const response = await fetch(withKey(url), { cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status, data });
  return data;
}
async function identity() {
  try { whoami = await request('/api/whoami'); } catch { /* Not proof of admin access. */ }
}
function metadata(value, fallback) {
  if (!value || value.id !== fallback.id) return { ...fallback, unavailable: true };
  return {
    ...fallback, id: value.id, title: typeof value.title === 'string' && value.title.trim() ? value.title : fallback.title,
    canDelete: value.canDelete === true, isOwned: value.isOwned === true, isAdmin: value.isAdmin === true,
    pendingCount: Number.isInteger(value.pendingCount) && value.pendingCount >= 0 ? value.pendingCount : null,
    activityAt: typeof value.activityAt === 'string' && Number.isFinite(Date.parse(value.activityAt)) ? value.activityAt : null,
  };
}
async function loadDocs({ restore = false } = {}) {
  const token = ++generation, requestedView = view;
  loading = true; loadError = false; docs = []; render();
  let result = [], failed = false;
  try {
    if (requestedView === 'mine') {
      await identity();
      const data = await request('/api/docs?scope=mine');
      if (!Array.isArray(data.docs) || !Array.isArray(data.metadata)) throw new Error('Invalid document list');
      const byId = new Map(data.metadata.map(item => [item.id, item]));
      result = [...new Set(data.docs)].filter(validId).map(id => metadata(byId.get(id), { id, title: id }));
    } else {
      const recent = readHistory();
      // Only exact locally remembered IDs; never discover documents globally.
      let cursor = 0;
      result = new Array(recent.length);
      await Promise.all(Array.from({ length: Math.min(6, recent.length) }, async () => {
        while (cursor < recent.length) {
          const index = cursor++, item = recent[index];
          try { result[index] = metadata(await request(`/api/doc-meta/${encodeURIComponent(item.id)}`), item); }
          catch (error) { result[index] = { ...item, unavailable: true, networkError: !error.status || error.status >= 500 }; }
        }
      }));
      if (recent.length && result.every(item => item.networkError)) failed = true;
    }
  } catch { failed = true; }
  if (token !== generation || view !== requestedView) return;
  docs = result; loadError = failed;
  docs.forEach(doc => knownIds.add(doc.id));
  loading = false; render();
  if (restore) requestAnimationFrame(() => window.scrollTo(0, loadHomeState().scrollY));
}
function empty(title, text, label, run) {
  const li = el('li', 'empty');
  li.append(el('h2', '', title), el('p', '', text));
  if (label) li.append(button(label, run, 'primary'));
  $('#rows').append(li);
}
function render() {
  closeMenu();
  for (const name of ['recent', 'mine']) {
    $('#' + name).classList.toggle('selected', view === name);
    $('#' + name).setAttribute('aria-pressed', String(view === name));
  }
  if ($('#search').value !== query) $('#search').value = query;
  $('#clear').hidden = view !== 'recent';
  put($('#mine'),copy('home.mine'));
  put($('#context'),view === 'recent' ? copy('home.recentContext') : whoami.isOwner ? copy('home.adminContext') : copy('home.mineContext'));
  $('#rows').replaceChildren();pruneBindings();
  $('#rows').setAttribute('aria-busy', String(loading));
  if (loading) { empty(copy('home.loading'), ''); return; }
  if (loadError) {
    empty(copy('home.loadFailed'), copy('home.loadHelp'), copy('common.retry'), () => loadDocs());
    return;
  }
  const list = docs.filter(doc => doc.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  if (!list.length) {
    empty(query ? copy('home.noMatch') : view === 'recent' ? copy('home.noRecent') : copy('home.noMine'),
      query ? copy('home.searchHelp') : view === 'recent' ? copy('home.recentHelp') : copy('home.mineHelp'),
      query ? copy('home.clearSearch') : copy('import.title'), () => { if (query) { query = ''; save(); render(); } else showImport(); });
    return;
  }
  for (const doc of list) {
    const li = el('li', 'row');
    const link = el('a', 'doc'); link.href = viewerUrl(doc.id);
    const icon = el('span', 'fileicon'); icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 24 30"><path d="M4 1h10l6 6v21H4zM14 1v7h6M8 14h8M8 19h8"/></svg>';
    const body = el('span'), meta = el('span', 'meta');
    body.append(el('span', 'title', doc.title));
    if (doc.unavailable) meta.append(el('span', '', copy('home.unavailable')));
    else {
      if (doc.pendingCount > 0) meta.append(el('span', 'pending', copy('home.pending',{count:doc.pendingCount})));
      const when = view === 'recent' ? doc.openedAt : doc.activityAt;
      if (when) meta.append(el('span', '', copy(view==='recent'?'home.opened':'home.activity',{date:date(when)})));
      if (whoami.isOwner) meta.append(el('span', '', doc.isOwned ? copy('home.adminCreated') : copy('home.adminManage')));
    }
    body.append(meta); link.append(icon, body);
    link.addEventListener('click', save);
    const more = button('···', () => menu(more, doc), 'more');
    put(more,copy('home.more',{title:doc.title}),'aria-label');
    more.setAttribute('aria-expanded', 'false'); more.setAttribute('aria-haspopup', 'true');
    li.append(link, more); $('#rows').append(li);
  }
}
function closeMenu(returnFocus = false) {
  const menu = $('.menu');
  if (!menu) return;
  const trigger = menu.previousElementSibling;
  if (returnFocus) trigger?.focus();
  trigger?.setAttribute('aria-expanded', 'false'); menu.remove();
}
function menu(trigger, doc) {
  if ($('.menu')?.previousElementSibling === trigger) { closeMenu(true); return; }
  closeMenu();
  const panel = el('div', 'menu');
  const action = (label, run, cls = '') => panel.append(button(label, () => { closeMenu(true); run(); }, cls));
  action(copy('home.share'), () => share(doc));
  if (view === 'recent') action(copy('home.remove'), () => confirmBox(copy('home.removeTitle'), copy('home.removeHelp'), copy('home.removeConfirm'), async () => { removeRecent(doc.id); dismiss(); await loadDocs(); toast(copy('home.removed')); }));
  if (doc.canDelete && !doc.unavailable) action(copy('home.deleteMenu'), () => confirmBox(copy('home.deleteTitle'), copy('home.deleteHelp',{title:doc.title}), copy('home.delete'), () => deleteDoc(doc), true), 'danger');
  trigger.after(panel); trigger.setAttribute('aria-expanded', 'true'); panel.querySelector('button').focus();
}
function showDialog(title, body, actions, onClose = null) {
  if (!modal.open) opener = document.activeElement;
  closeAction = onClose;
  $('#modalbody').innerHTML = `<div class="modalhead"><h2 id="modalTitle">${esc(title)}</h2><button class="close" id="modalClose" aria-label="Close dialog" data-i18n-aria-label="common.dialogClose">×</button></div>${body}`;
  $('#modalfoot').replaceChildren();
  for (const action of actions) {
    const node = button(action.text, action.run, action.cls || '');
    if (action.id) node.id = action.id;
    $('#modalfoot').append(node);
  }
  put($('#modalTitle'),title);bindShell($('#modalbody'));$('#modalClose').before(languageSelect());
  $('#modalClose').onclick = dismiss;
  if (!modal.open) modal.showModal();
  $('#modalbody').scrollTop = 0; $('#modalClose').focus();
}
function dismiss() {
  if (busy) return;
  const callback = closeAction; closeAction = null;
  modal.close(); if (opener?.isConnected) opener.focus();
  if (callback) callback();
}
function setBusy(value) {
  busy = value;
  modal.querySelectorAll('button,input,textarea').forEach(node => { node.disabled = value; });
}
function confirmBox(title, text, label, run, danger = false) {
  showDialog(title, `<p>${esc(text)}</p><p id="actionError" class="error" role="alert"></p>`, [
    { text: copy('common.cancel'), run: dismiss }, { text: label, cls: danger ? 'danger' : 'primary', run },
  ]);
  put($('#modalbody p'),text);
}
async function deleteDoc(doc) {
  setBusy(true);
  try {
    // Fresh permission check as well as the DELETE endpoint's server authorization.
    const latest = await request(`/api/doc-meta/${encodeURIComponent(doc.id)}`);
    if (latest.canDelete !== true) throw Object.assign(new Error('not_your_doc'), { data: { error: 'not_your_doc' } });
    await request(`/api/doc/${encodeURIComponent(doc.id)}`, { method: 'DELETE' });
    // Read back the exact target; do not claim deletion if it still exists.
    try { await request(`/api/doc-meta/${encodeURIComponent(doc.id)}`); throw failure(copy('home.deleteStillExists')); }
    catch (error) { if (error.status !== 404) throw error; }
    removeRecent(doc.id); setBusy(false); dismiss(); await loadDocs(); toast(copy('home.deleted'));
  } catch (error) {
    put($('#actionError'),errorMessage(error)); setBusy(false);
    // Do not leave stale deletion authority on the page after a failed check.
    doc.canDelete = false; render();
  }
}
function share(doc) {
  const url = new URL(viewerUrl(doc.id), location.origin).href;
  showDialog(copy('home.share'), "<p class=\"small\"><span data-i18n=\"home.shareHelp\">This link opens the review directly, bypassing the homepage. Sharing here does not change document access.</span></p><input class=\"sharelink\" aria-label=\"Document link\" data-i18n-aria-label=\"home.documentLink\" readonly>", [
    { text: copy('common.close'), run: dismiss }, { text: copy('common.copyLink'), cls: 'primary', run: async () => {
      try { await navigator.clipboard.writeText(url); toast(copy('common.copied')); }
      catch { $('.sharelink').select(); toast(copy('common.copyManually')); }
    } },
  ]);
  $('.sharelink').value = url;
}
function errorMessage(error) {
  if(error.copy)return error.copy;
  if (error.userMessage) return error.userMessage;
  const code = error.data?.error;
  const errors = {
    invalid_doc_id: copy('errors.invalid_doc_id'),
    empty_html: copy('errors.empty_html'), not_html: copy('errors.not_html'),
    too_large: copy('errors.too_large',{size:error.data?.maxBytes?Math.round(error.data.maxBytes/1024/1024):2}),
    doc_exists: copy('errors.doc_exists'), write_failed: copy('errors.write_failed'),
    guest_doc_limit: copy('errors.guest_doc_limit',{count:whoami.docLimit||1}),
    not_your_doc: copy('errors.not_your_doc'), doc_not_found: copy('errors.doc_not_found'),
    capacity_full: copy('errors.capacity_full'), rate_limited: copy('errors.rate_limited'),
    invalid_asset_name: copy('errors.invalid_asset_name'), empty_asset: copy('errors.empty_asset'),
    invalid_asset_type: copy('errors.invalid_asset_type'),
  };
  return errors[code] || (!error.status && error.message === 'Failed to fetch' ? copy('errors.network') : !error.status ? copy('errors.failed') : copy('errors.reason',{reason:code||error.status}));
}

function showImport() {
  importDraft = null;
  showDialog(copy('import.title'), `<div id="importForm"><label class="upload"><span data-i18n="import.choose">Choose an HTML document</span><input id="htmlFile" type="file" accept=".html,.htm,text/html"></label><p class="small" id="fileLabel"><span data-i18n="import.fileHelp">Supports .html / .htm, up to 2 MB. The HTML &lt;title&gt; supplies the document title.</span></p><label class="field"><span data-i18n="import.imagesOptional">Local images (optional)</span><input id="images" type="file" accept="image/*" multiple></label><label class="field"><span data-i18n="agent.resourceFolder"></span><input id="resourceFolder" type="file" webkitdirectory multiple></label><label class="field"><span data-i18n="agent.previous"></span><input id="previousReview" type="url"></label><label class="field"><span><input id="independentReview" type="checkbox"> <span data-i18n="agent.independent"></span></span></label><p class="small" id="importSummary" role="status"></p><p class="small" id="imageLabel"><span data-i18n="import.imagesHelp">Select images referenced by the HTML; uploads are matched by filename.</span></p><details class="paste"><summary><span data-i18n="import.paste">Or paste HTML source</span></summary><textarea id="source" aria-label="HTML source" data-i18n-aria-label="import.source" placeholder="<!doctype html>\n<html><head><title>Document title</title></head>…"></textarea><label class="field" for="paste-id"><span data-i18n="import.id">Document name (used in its link)</span><input id="paste-id" type="text" autocomplete="off" spellcheck="false" placeholder="letters-numbers_dots"></label></details></div><div id="duplicate" hidden><p id="duplicateText"></p><p class="warn"><span data-i18n="import.replacementHelp">Replace overwrites the source but keeps review history; existing annotations may no longer match. Choose Keep both to preserve the original document and review.</span></p></div><p class="error" id="importError" role="alert"></p>`, [
    { text: copy('common.cancel'), run: dismiss }, { text: copy('import.open'), cls: 'primary', id: 'doImport', run: prepareImport },
  ]);
  bind($('#source'),'import.sourcePlaceholder',{},'placeholder');
  let previewGeneration=0;
  const summarize=async()=>{const generation=++previewGeneration;const file=$('#htmlFile').files[0];const html=file?await file.text():$('#source').value;if(generation!==previewGeneration||!$('#importSummary'))return;const title=new DOMParser().parseFromString(html,'text/html').title||file?.name||$('#paste-id').value||'HTML';bind($('#importSummary'),'agent.summary',{title,count:$('#resourceFolder').files.length+$('#images').files.length});};
  $('#htmlFile').onchange = () => {put($('#fileLabel'),$('#htmlFile').files[0]?.name || copy('import.shortFileHelp'));summarize();};
  $('#source').addEventListener('input',summarize);$('#resourceFolder').addEventListener('change',summarize);$('#images').addEventListener('change',summarize);
  $('#images').onchange=()=>put($('#imageLabel'),copy('import.selected',{count:$('#images').files.length}));
}
async function prepareImport() {
  put($('#importError'),'');
  const file = $('#htmlFile').files[0];
  setBusy(true);
  try {
    if (file && !/\.html?$/i.test(file.name)) throw failure(copy('import.htmlOnly'));
    const limits=await importPolicy();
    if (file && file.size > limits.file) throw Error(`bundle_too_large:file=${limits.file}`);
    const html = file ? await file.text() : $('#source').value;
    if (!html.trim()) throw failure(copy('import.chooseOrPaste'));
    if (new TextEncoder().encode(html).length > limits.file) throw Error(`bundle_too_large:file=${limits.file}`);
    if (!/<[a-z!][\s\S]*>/i.test(html)) throw failure(copy('errors.not_html'));
    // Retain legacy filename slug behavior; explicit paste IDs are validated as typed.
    const id = file ? file.name.replace(/\.html?$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') : $('#paste-id').value.trim();
    if (!validId(id)) throw failure(copy('errors.invalid_doc_id'));
    // Only parse inert metadata; never attach imported nodes or execute a preview.
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    importDraft = { id, base: id, html, title: parsed.title.trim() || file?.name.replace(/\.html?$/i, '') || id, images: [...$('#images').files], overwrite: false, resources: [...$('#resourceFolder').files], previous: $('#previousReview').value.trim(), independent:$('#independentReview').checked };
    setBusy(false);
    await uploadDocument();
  } catch (error) { put($('#importError'),error.copy||copy('errors.reason',{reason:error.message||'unknown'})); setBusy(false); }
}
function importButtons() {
  $('#modalfoot').replaceChildren(button(copy('common.cancel'), dismiss), button(copy('import.open'), prepareImport, 'primary'));
}
function cancelDuplicate() {
  if (busy) return;
  $('#duplicate').hidden = true; $('#importForm').hidden = false;
  put($('#modalTitle'),copy('import.title')); put($('#importError'),'');
  $('#modalClose').onclick = dismiss; closeAction = null; importButtons(); $('#htmlFile').focus();
}
function showDuplicate() {
  setBusy(false);
  $('#importForm').hidden = true; $('#duplicate').hidden = false;
  put($('#modalTitle'),copy('import.duplicate'));
  put($('#duplicateText'),copy('import.exists',{id:importDraft.id}));
  put($('#importError'),'');
  $('#modalfoot').replaceChildren(
    button(copy('common.cancel'), cancelDuplicate),
    button(copy('import.replace'), () => { importDraft.overwrite = true; uploadDocument(); }, 'danger'),
    button(copy('import.keepBoth'), () => {
      let n = 2;
      const candidate = value => `${importDraft.base.slice(0, 128 - String(value).length - 1)}-${value}`;
      while (knownIds.has(candidate(n))) n++;
      importDraft.id = candidate(n); importDraft.overwrite = false; uploadDocument();
    }, 'primary'),
  );
  $('#modalClose').onclick = cancelDuplicate;
  closeAction = null; $('#modalfoot button').focus();
}
async function uploadDocument() {
  if (busy) return;
  setBusy(true); put($('#importError'),'');
  const draft = importDraft;
  try {
    // The same manifest contract as the installed CLI. Only explicitly selected files.
    const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    const selected=new Map();
    for(const f of [...draft.images,...draft.resources]){const name=f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(1).join('/') : f.name;if(selected.has(name))throw new Error('duplicate_resource_path');selected.set(name,f);}
    let entry=$('#htmlFile').files[0]?.name||'document.html';
    const matches=[...selected.keys()].filter(n=>n.split('/').pop()===entry);
    if(matches.length>1)throw new Error('ambiguous_entry_path');if(matches.length===1)entry=matches[0];
    selected.set(entry,$('#htmlFile').files[0]||new Blob([draft.html],{type:'text/html'}));
    const limits=await importPolicy();if(selected.size>limits.count)throw new Error(`too_many_resources:max=${limits.count}`);let total=0;const files=[];
    for(const [name,f]of selected){total+=f.size;if(f.size>limits.file||total>limits.total)throw new Error(`bundle_too_large:file=${limits.file}:total=${limits.total}`);const bytes=await f.arrayBuffer();files.push({path:name,data:await fileToBase64(f),sha256:await hash(bytes)});}
    const fingerprint=await hash(new TextEncoder().encode(JSON.stringify(files.map(f=>[f.path,f.sha256]).sort())));
    let previous=null;
    if(draft.previous){const u=new URL(draft.previous,location.origin);if(u.origin!==location.origin||u.pathname!=='/viewer.html'||!validId(u.searchParams.get('doc')))throw new Error('invalid_version_parent');previous=u.searchParams.get('doc');}
    const result=await request('/api/imports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entry,files,source:draft.independent?crypto.randomUUID():fingerprint,previous})});
    setBusy(false);location.href='/viewer.html?doc='+encodeURIComponent(result.document);

  } catch (error) {
    setBusy(false);
    if (error.status === 409 && error.data?.error === 'doc_exists') { knownIds.add(draft.id); showDuplicate(); }
    else put($('#importError'),errorMessage(error));
  }
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
  });
}
function openImported(draft) { save(); location.assign(viewerUrl(draft.id)); }
async function verifyImage(name, file) {
  const response = await fetch(withKey(`/docs/assets/${encodeURIComponent(name)}`), { cache: 'no-store' });
  if (!response.ok) throw Object.assign(new Error('asset_verification_failed'), {
    copy:copy('import.verifyImage',{name}),
  });
  const stored = new Uint8Array(await response.arrayBuffer());
  const selected = new Uint8Array(await file.arrayBuffer());
  if (stored.length !== selected.length || !stored.every((byte, index) => byte === selected[index])) {
    throw Object.assign(new Error('asset_collision'), {
      copy:copy('import.collision',{name}),
    });
  }
}
async function prepareImages(draft) {
  const refs = referencedImages(draft.html);
  if (!refs.length) return [];
  // Stored names are case-sensitive, just like the server's filesystem.
  const have = new Set((await request('/api/assets')).assets);
  const byName = new Map(draft.images.map(file => [file.name.toLowerCase(), file]));
  // Check every existing selected image before making any asset writes.
  for (const ref of refs) {
    const file = byName.get(ref.name.toLowerCase());
    if (file && have.has(ref.name)) await verifyImage(ref.name, file);
  }
  const needed = [];
  for (const ref of refs) {
    if (have.has(ref.name)) continue;
    const file = byName.get(ref.name.toLowerCase());
    if (!file) { needed.push(ref); continue; }
    await request('/api/upload-asset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: ref.name, dataBase64: await fileToBase64(file) }) });
    // existed:true may mean another import won the race; verify actual bytes.
    await verifyImage(ref.name, file);
  }
  return needed;
}
async function offerImages(draft, needed) {
  if (!needed.length) { openImported(draft); return; }
  // The document is already saved. Asset retries must never upload it again.
  showDialog(copy('import.missingTitle'), `<p class="small"><span data-i18n="import.missingHelp">The document is saved. Select files for the missing images below, or skip and open it.</span></p><ul class="image-list">${needed.map(ref => `<li>${esc(ref.name)}</li>`).join('')}</ul><label class="field"><span data-i18n="import.images">Local images</span><input id="missingImages" type="file" accept="image/*" multiple></label><p class="small" id="selectedImages"></p><p class="error" id="assetError" role="alert"></p>`, [
    { text: copy('import.skip'), run: () => openImported(draft) },
    { text: copy('import.uploadOpen'), cls: 'primary', run: () => uploadImages(draft, needed) },
  ]);
  put($('#selectedImages'),draft.images.length?copy('import.retained',{count:draft.images.length}):copy('import.matchHelp'));
  $('#missingImages').onchange = () => {
    const byName = new Map(draft.images.map(file => [file.name.toLowerCase(), file]));
    for (const file of $('#missingImages').files) byName.set(file.name.toLowerCase(), file);
    draft.images = [...byName.values()];
    put($('#selectedImages'),copy('import.count',{count:draft.images.length}));
  };
}
async function uploadImages(draft, needed) {
  setBusy(true); put($('#assetError'),'');
  try {
    const remaining = await prepareImages(draft);
    needed.splice(0, needed.length, ...remaining);
    setBusy(false);
    if (!needed.length) { openImported(draft); return; }
    put($('#assetError'),copy('import.stillMissing',{names:needed.map(ref=>ref.name).join(', ')}));
  } catch (error) {
    setBusy(false);
    put($('#assetError'),errorMessage(error));
  }
}

modal.addEventListener('cancel', event => {
  event.preventDefault();
  if (busy) return;
  if ($('#duplicate') && !$('#duplicate').hidden) cancelDuplicate(); else dismiss();
});
modal.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const items = [...modal.querySelectorAll('button,input,textarea,select,summary,a[href]')].filter(node => !node.disabled && node.getClientRects().length);
  const first = items[0], last = items.at(-1);
  if (!first) { event.preventDefault(); return; }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
document.addEventListener('click', event => { if (!event.target.closest('.menu,.more')) closeMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.open) closeMenu(true); });
$('#import').onclick = showImport;
for (const name of ['recent', 'mine']) $('#' + name).onclick = () => { if (view !== name) { view = name; save(); loadDocs(); } };
$('#search').oninput = event => { query = event.target.value; save(); render(); };
$('#clear').onclick = () => confirmBox(copy('home.clearTitle'), copy('home.clearHelp'), copy('home.clear'), () => { clearRecent(); dismiss(); loadDocs(); });
window.addEventListener('pagehide', save);
window.addEventListener('pageshow', event => { if (event.persisted) loadDocs({ restore: true }); });
window.addEventListener('storage', event => { if (event.key === HISTORY_KEY && view === 'recent') loadDocs(); });
bindShell(document.documentElement);document.querySelector('.top').insertBefore(languageSelect(),$('#import'));
onLocaleChange(()=>{render();document.title=t('home.title')});document.title=t('home.title');
await identity();
loadDocs({ restore: true });
