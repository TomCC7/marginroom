import { referencedImages } from './assets.js';
import { readHistory, removeRecent, clearRecent, loadHomeState, saveHomeState, HISTORY_KEY } from './entry-history.js';

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
const MAX_HTML_BYTES = 2_000_000;
const state = loadHomeState();
let view = state.view, query = state.query, docs = [], loading = false, loadError = false, generation = 0;
let whoami = { isOwner: false, docLimit: 1 };
let opener = null, closeAction = null, busy = false, importDraft = null;
const knownIds = new Set();
const modal = $('#modal');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, run, cls = '') {
  const node = el('button', cls, text);
  node.type = 'button';
  node.onclick = run;
  return node;
}
function toast(text) {
  $('#toast').textContent = text;
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
  $('#mine').textContent = '我的文稿';
  $('#context').textContent = view === 'recent' ? '此浏览器打开过的文稿' : whoami.isOwner ? '管理员身份创建的文稿；不包含仅可管理的其他文稿' : '由当前签名浏览器身份创建的文稿';
  $('#rows').replaceChildren();
  $('#rows').setAttribute('aria-busy', String(loading));
  if (loading) { empty('正在加载文稿…', ''); return; }
  if (loadError) {
    empty('暂时无法加载文稿', '请检查网络连接后重试。此浏览器的阅读记录不会被清空。', '重试', () => loadDocs());
    return;
  }
  const list = docs.filter(doc => doc.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  if (!list.length) {
    empty(query ? '没有匹配的文稿' : view === 'recent' ? '还没有打开记录' : '这里还没有你的文稿',
      query ? '换一个标题关键词试试。' : view === 'recent' ? '通过文稿链接打开的页面会出现在这里。打开记录不代表拥有管理权限。' : '这里只显示当前身份创建的文稿，不是账号，也不会跨设备同步。',
      query ? '清除搜索' : '导入 HTML', () => { if (query) { query = ''; save(); render(); } else showImport(); });
    return;
  }
  for (const doc of list) {
    const li = el('li', 'row');
    const link = el('a', 'doc'); link.href = viewerUrl(doc.id);
    const icon = el('span', 'fileicon'); icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 24 30"><path d="M4 1h10l6 6v21H4zM14 1v7h6M8 14h8M8 19h8"/></svg>';
    const body = el('span'), meta = el('span', 'meta');
    body.append(el('span', 'title', doc.title));
    if (doc.unavailable) meta.append(el('span', '', '文稿不可用或暂时无法读取'));
    else {
      if (doc.pendingCount > 0) meta.append(el('span', 'pending', `${doc.pendingCount} 条未处理批注`));
      const when = view === 'recent' ? doc.openedAt : doc.activityAt;
      if (when) meta.append(el('span', '', `${view === 'recent' ? '打开于' : '最近活动'} ${new Date(when).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`));
      if (whoami.isOwner) meta.append(el('span', '', doc.isOwned ? '管理员身份创建' : '管理员可管理'));
    }
    body.append(meta); link.append(icon, body);
    link.addEventListener('click', save);
    const more = button('···', () => menu(more, doc), 'more');
    more.setAttribute('aria-label', `${doc.title}的更多操作`);
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
  action('分享文稿链接', () => share(doc));
  if (view === 'recent') action('移出最近打开', () => confirmBox('移出最近打开？', '仅移除此浏览器的打开记录，不删除服务器文稿，也不改变链接访问权限。', '移出记录', async () => { removeRecent(doc.id); dismiss(); await loadDocs(); toast('已移出本地记录'); }));
  if (doc.canDelete && !doc.unavailable) action('删除文稿…', () => confirmBox('删除这篇文稿？', `“${doc.title}”及其全部评审历史将被删除，分享链接也将失效。此操作无法撤销。`, '删除文稿', () => deleteDoc(doc), true), 'danger');
  trigger.after(panel); trigger.setAttribute('aria-expanded', 'true'); panel.querySelector('button').focus();
}
function showDialog(title, body, actions, onClose = null) {
  if (!modal.open) opener = document.activeElement;
  closeAction = onClose;
  $('#modalbody').innerHTML = `<div class="modalhead"><h2 id="modalTitle">${esc(title)}</h2><button class="close" id="modalClose" aria-label="关闭对话框">×</button></div>${body}`;
  $('#modalfoot').replaceChildren();
  for (const action of actions) {
    const node = button(action.text, action.run, action.cls || '');
    if (action.id) node.id = action.id;
    $('#modalfoot').append(node);
  }
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
    { text: '取消', run: dismiss }, { text: label, cls: danger ? 'danger' : 'primary', run },
  ]);
}
async function deleteDoc(doc) {
  setBusy(true);
  try {
    // Fresh permission check as well as the DELETE endpoint's server authorization.
    const latest = await request(`/api/doc-meta/${encodeURIComponent(doc.id)}`);
    if (latest.canDelete !== true) throw Object.assign(new Error('not_your_doc'), { data: { error: 'not_your_doc' } });
    await request(`/api/doc/${encodeURIComponent(doc.id)}`, { method: 'DELETE' });
    // Read back the exact target; do not claim deletion if it still exists.
    try { await request(`/api/doc-meta/${encodeURIComponent(doc.id)}`); throw new Error('文稿仍存在，请重试。'); }
    catch (error) { if (error.status !== 404) throw error; }
    removeRecent(doc.id); setBusy(false); dismiss(); await loadDocs(); toast('文稿已删除');
  } catch (error) {
    $('#actionError').textContent = errorMessage(error); setBusy(false);
    // Do not leave stale deletion authority on the page after a failed check.
    doc.canDelete = false; render();
  }
}
function share(doc) {
  const url = new URL(viewerUrl(doc.id), location.origin).href;
  showDialog('分享文稿链接', '<p class="small">链接直接打开评审页面，不经过首页。这里不改变文稿的访问设置。</p><input class="sharelink" aria-label="文稿链接" readonly>', [
    { text: '关闭', run: dismiss }, { text: '复制链接', cls: 'primary', run: async () => {
      try { await navigator.clipboard.writeText(url); toast('链接已复制'); }
      catch { $('.sharelink').select(); toast('请选择并复制链接'); }
    } },
  ]);
  $('.sharelink').value = url;
}
function errorMessage(error) {
  if (error.userMessage) return error.userMessage;
  const code = error.data?.error;
  const errors = {
    invalid_doc_id: '文稿名称限 128 字符，只能使用英文字母、数字、点、短横线或下划线；不能为单点、双点或以 .raw 结尾。',
    empty_html: 'HTML 内容为空。', not_html: '没有识别到 HTML 内容，请包含 HTML 标签。',
    too_large: `文件过大（上限 ${error.data?.maxBytes ? Math.round(error.data.maxBytes / 1024 / 1024) : 2} MB）。`,
    doc_exists: '同名文稿已存在，请选择保留两份或替换。', write_failed: '服务器无法保存文件，请重试。',
    guest_doc_limit: `当前浏览器最多可创建 ${whoami.docLimit || 1} 份文稿。请先在「我的文稿」中管理已有文稿。`,
    not_your_doc: '这份文稿不属于当前浏览器身份，无法执行此操作。', doc_not_found: '文稿已不存在。',
    capacity_full: '服务存储容量已满，请稍后再试。', rate_limited: '操作过于频繁，请稍后再试。',
    invalid_asset_name: '图片文件名不符合要求。', empty_asset: '图片内容为空。',
    invalid_asset_type: '不支持此图片类型。',
  };
  return errors[code] || (!error.status && error.message === 'Failed to fetch' ? '网络错误，请检查连接后重试。输入和所选文件已保留。' : !error.status ? '操作失败，请检查网络后重试。输入和所选文件已保留。' : `操作失败（${code || error.status}），请重试。`);
}

function showImport() {
  importDraft = null;
  showDialog('导入 HTML', `<div id="importForm"><label class="upload">选择一份 HTML 文稿<input id="htmlFile" type="file" accept=".html,.htm,text/html"></label><p class="small" id="fileLabel">支持 .html / .htm，最大 2 MB。标题优先取自 HTML 的 &lt;title&gt;。</p><label class="field">本地图片（可选）<input id="images" type="file" accept="image/*" multiple></label><p class="small" id="imageLabel">可同时选择 HTML 中引用的图片；按文件名匹配并上传。</p><details class="paste"><summary>或粘贴 HTML 源码</summary><textarea id="source" aria-label="HTML 源码" placeholder="<!doctype html>\n<html><head><title>文稿标题</title></head>…"></textarea><label class="field" for="paste-id">文稿名称（用于链接）<input id="paste-id" type="text" autocomplete="off" spellcheck="false" placeholder="letters-numbers_dots"></label></details></div><div id="duplicate" hidden><p id="duplicateText"></p><p class="warn">替换会覆盖原文稿源码，但会保留评审历史；原有批注可能不再匹配新内容。建议选择「保留两份」，以保留原文稿及其评审记录。</p></div><p class="error" id="importError" role="alert"></p>`, [
    { text: '取消', run: dismiss }, { text: '导入并打开', cls: 'primary', id: 'doImport', run: prepareImport },
  ]);
  $('#htmlFile').onchange = () => { $('#fileLabel').textContent = $('#htmlFile').files[0]?.name || '支持 .html / .htm，最大 2 MB。'; };
  $('#images').onchange = () => { $('#imageLabel').textContent = `已选择 ${$('#images').files.length} 张图片；按引用文件名匹配并上传。`; };
}
async function prepareImport() {
  $('#importError').textContent = '';
  const file = $('#htmlFile').files[0];
  setBusy(true);
  try {
    if (file && !/\.html?$/i.test(file.name)) throw new Error('请选择 .html 或 .htm 文件，图片请放在「本地图片」中。');
    if (file && file.size > MAX_HTML_BYTES) throw new Error('HTML 超过 2 MB，请缩小文件后重新选择。');
    const html = file ? await file.text() : $('#source').value;
    if (!html.trim()) throw new Error('请选择 HTML 文件，或展开下方入口粘贴源码。');
    if (new TextEncoder().encode(html).length > MAX_HTML_BYTES) throw new Error('HTML 超过 2 MB，请缩小内容后重试。');
    if (!/<[a-z!][\s\S]*>/i.test(html)) throw new Error('没有识别到 HTML 内容，请包含 HTML 标签。');
    // Retain legacy filename slug behavior; explicit paste IDs are validated as typed.
    const id = file ? file.name.replace(/\.html?$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') : $('#paste-id').value.trim();
    if (!validId(id)) throw new Error('文稿名称限 128 字符，只能使用英文字母、数字、点、短横线或下划线；不能为单点、双点或以 .raw 结尾。');
    // Only parse inert metadata; never attach imported nodes or execute a preview.
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    importDraft = { id, base: id, html, title: parsed.title.trim() || file?.name.replace(/\.html?$/i, '') || id, images: [...$('#images').files], overwrite: false };
    setBusy(false);
    if (knownIds.has(id)) showDuplicate();
    else await uploadDocument();
  } catch (error) { $('#importError').textContent = error.message; setBusy(false); }
}
function importButtons() {
  $('#modalfoot').replaceChildren(button('取消', dismiss), button('导入并打开', prepareImport, 'primary'));
}
function cancelDuplicate() {
  if (busy) return;
  $('#duplicate').hidden = true; $('#importForm').hidden = false;
  $('#modalTitle').textContent = '导入 HTML'; $('#importError').textContent = '';
  $('#modalClose').onclick = dismiss; closeAction = null; importButtons(); $('#htmlFile').focus();
}
function showDuplicate() {
  setBusy(false);
  $('#importForm').hidden = true; $('#duplicate').hidden = false;
  $('#modalTitle').textContent = '文稿已存在';
  $('#duplicateText').textContent = `“${importDraft.id}”已存在。`;
  $('#importError').textContent = '';
  $('#modalfoot').replaceChildren(
    button('取消', cancelDuplicate),
    button('替换', () => { importDraft.overwrite = true; uploadDocument(); }, 'danger'),
    button('保留两份', () => {
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
  setBusy(true); $('#importError').textContent = '';
  const draft = importDraft;
  try {
    // Check selected assets (including upload races) before saving HTML.
    const needed = await prepareImages(draft);
    await request('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: draft.id, html: draft.html, overwrite: draft.overwrite }) });
    knownIds.add(draft.id); draft.saved = true;

    setBusy(false);
    await offerImages(draft, needed);
  } catch (error) {
    setBusy(false);
    if (error.status === 409 && error.data?.error === 'doc_exists') { knownIds.add(draft.id); showDuplicate(); }
    else $('#importError').textContent = errorMessage(error);
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
    userMessage: `无法核实图片“${name}”的内容，请检查网络后重试。输入和所选文件已保留。`,
  });
  const stored = new Uint8Array(await response.arrayBuffer());
  const selected = new Uint8Array(await file.arrayBuffer());
  if (stored.length !== selected.length || !stored.every((byte, index) => byte === selected[index])) {
    throw Object.assign(new Error('asset_collision'), {
      userMessage: `图片“${name}”与服务器已有的全局同名图片内容不同，不能替换或借用。请在本地重命名图片并修改 HTML 中的引用后，重新选择文件再导入。输入和所选文件已保留，未继续保存文稿或打开页面。`,
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
  showDialog('补充本地图片', `<p class="small">文稿已保存。以下图片尚未上传；请选择对应文件，或跳过并直接打开。</p><ul class="image-list">${needed.map(ref => `<li>${esc(ref.name)}</li>`).join('')}</ul><label class="field">本地图片<input id="missingImages" type="file" accept="image/*" multiple></label><p class="small" id="selectedImages"></p><p class="error" id="assetError" role="alert"></p>`, [
    { text: '跳过并打开', run: () => openImported(draft) },
    { text: '上传图片并打开', cls: 'primary', run: () => uploadImages(draft, needed) },
  ]);
  $('#selectedImages').textContent = draft.images.length ? `已保留 ${draft.images.length} 张所选图片，可直接上传。` : '按文件名匹配，不会自动读取本地文件夹。';
  $('#missingImages').onchange = () => {
    const byName = new Map(draft.images.map(file => [file.name.toLowerCase(), file]));
    for (const file of $('#missingImages').files) byName.set(file.name.toLowerCase(), file);
    draft.images = [...byName.values()];
    $('#selectedImages').textContent = `已选择 ${draft.images.length} 张图片。`;
  };
}
async function uploadImages(draft, needed) {
  setBusy(true); $('#assetError').textContent = '';
  try {
    const remaining = await prepareImages(draft);
    needed.splice(0, needed.length, ...remaining);
    setBusy(false);
    if (!needed.length) { openImported(draft); return; }
    $('#assetError').textContent = `仍需选择匹配文件：${needed.map(ref => ref.name).join('、')}`;
  } catch (error) {
    setBusy(false);
    $('#assetError').textContent = errorMessage(error);
  }
}

modal.addEventListener('cancel', event => {
  event.preventDefault();
  if (busy) return;
  if ($('#duplicate') && !$('#duplicate').hidden) cancelDuplicate(); else dismiss();
});
modal.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const items = [...modal.querySelectorAll('button,input,textarea,summary,a[href]')].filter(node => !node.disabled && node.getClientRects().length);
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
$('#clear').onclick = () => confirmBox('清空最近打开？', '仅清除此浏览器的打开记录，不删除服务器文稿。你仍可通过原来的链接打开文稿。', '清空记录', () => { clearRecent(); dismiss(); loadDocs(); });
window.addEventListener('pagehide', save);
window.addEventListener('pageshow', event => { if (event.persisted) loadDocs({ restore: true }); });
window.addEventListener('storage', event => { if (event.key === HISTORY_KEY && view === 'recent') loadDocs(); });
await identity();
loadDocs({ restore: true });
