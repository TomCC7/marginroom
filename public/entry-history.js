// Shared homepage/viewer history. No credentials or document content are stored.
// IDs are already canonical API IDs: never lowercase, decode, or slugify them.
export const HISTORY_KEY = 'marginroom.recent.v1';
export const HOME_STATE_KEY = 'marginroom.home.v1';
export const HISTORY_LIMIT = 100;
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[A-Za-z0-9._-]+$/.test(id) && id !== '.' && id !== '..' && !/\.raw$/i.test(id);
let memoryHistory = [];
let historyStorageUnavailable = false;
let memoryState = { view: 'recent', query: '', scrollY: 0 };
function cleanHistory(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter(item => {
    if (!item || !validId(item.id) || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, HISTORY_LIMIT).map(item => ({
    id: item.id, title: typeof item.title === 'string' ? item.title.slice(0, 500) : item.id,
    openedAt: typeof item.openedAt === 'string' && Number.isFinite(Date.parse(item.openedAt)) ? item.openedAt : null,
  }));
}
export function readHistory() {
  try {
    const saved = historyStorageUnavailable ? null : JSON.parse(localStorage.getItem(HISTORY_KEY) || 'null');
    if (saved?.version === 1) memoryHistory = cleanHistory(saved.entries);
  } catch { /* Storage unavailable: preserve this page's in-memory history. */ }
  return memoryHistory.map(item => ({ ...item }));
}
function writeHistory(items) {
  memoryHistory = cleanHistory(items);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify({ version: 1, entries: memoryHistory })); }
  catch { historyStorageUnavailable = true; }
  return readHistory();
}
export function rememberDoc({ id, title }) {
  if (!validId(id)) return readHistory();
  const current = readHistory();
  const previous = current.find(item => item.id === id);
  return writeHistory([{ id, title: title || previous?.title || id, openedAt: new Date().toISOString() }, ...current.filter(item => item.id !== id)]);
}
export function removeRecent(id) { return writeHistory(readHistory().filter(item => item.id !== id)); }
export function clearRecent() { return writeHistory([]); }
export function loadHomeState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(HOME_STATE_KEY) || 'null');
    if (saved?.version === 1) memoryState = cleanState(saved);
  } catch {}
  return { ...memoryState };
}
function cleanState(state) {
  return {
    view: state.view === 'mine' ? 'mine' : 'recent',
    query: typeof state.query === 'string' ? state.query.slice(0, 500) : '',
    scrollY: Number.isFinite(state.scrollY) ? Math.max(0, state.scrollY) : 0,
  };
}
export function saveHomeState(state) {
  memoryState = cleanState({ ...memoryState, ...state });
  try { sessionStorage.setItem(HOME_STATE_KEY, JSON.stringify({ version: 1, ...memoryState })); } catch {}
  return { ...memoryState };
}
