// markmyword server — Express + SQLite, single always-on box.
//
// Serves the static viewer and a small JSON API. Base document HTML comes from
// docs/<id>.html (immutable, trusted). Editor edits + version history live in
// SQLite. Identity is owner-vs-guest (HMAC-signed cookie, OWNER_KEY promotes):
// anyone may suggest, but editing/restoring/accepting is gated to the doc owner.
import express from 'express';
import {machineAuth,machineInstance,digest} from './machine-auth.js';
import {documentImports,validateBundle} from './document-imports.js';
import {locateAcross} from './version-navigation.js';
import { parse } from 'parse5';
import { readFile, writeFile, readdir, access, mkdir } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openDb, getOverlay, setBlockAndSnapshot, listVersions, getVersion, restoreVersion,
  listSuggestions, addSuggestion, getSuggestion, setSuggestionStatus,
  findSuggestionRequest, addSuggestionReply,
  setDocOwner, getDocOwner, countDocsOwnedBy, countGuestOwners, deleteDocData, ownerMap,
  getDocAccess, setDocAccess, ACCESS_LEVELS,
} from './db.js';
import { makeGuardrails, LIMITS } from './guardrails.js';
import { makeFeedbackHandler } from './feedback-api.js';
import { patchSource } from './source-patch.js';
import { randomUUID, createHash } from 'node:crypto';
import {plainText} from './db.js';
import { rm } from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {revisionService,RevisionError} from './revision-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DOCS_DIR holds deliverable HTML (seed + uploads). On a host with an ephemeral
// image filesystem (Fly), point HS_DOCS_DIR at a persistent volume so uploads
// survive redeploys; the baked-in seed docs are copied in on first boot.
const SEED_DOCS_DIR = path.join(__dirname, 'docs');
const DOCS_DIR = process.env.HS_DOCS_DIR || SEED_DOCS_DIR;
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3939;
const HOST = process.env.HOST || '127.0.0.1';
const MAX_TEXT = 50_000;
const MAX_DOC_BYTES = LIMITS.MAX_DOC_BYTES; // per-file size cap (default 2 MB)

const SAFE_ID = /^[a-zA-Z0-9._-]+$/;
// Reserve the internal source-file suffix: a document ID must never alias
// another document's .raw.html file or acquire independent ownership over it.
const isValidDocId = (id) =>
  typeof id === 'string' && id.length > 0 && id.length <= 128 && SAFE_ID.test(id) && id !== '.' && id !== '..' && !/\.raw$/i.test(id);

// Editor edits are stored as plain text and re-inserted as textContent, so
// escaping here makes the stored overlay injection-proof even though the author
// is trusted. (Belt-and-suspenders for the one value that round-trips storage.)
const escapeText = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function readDocHtml(id) {
  if (!isValidDocId(id)) return null;
  const file = path.join(DOCS_DIR, `${id}.html`);
  if (!file.startsWith(DOCS_DIR + path.sep)) return null; // defense in depth
  try { return await readFile(file, 'utf8'); } catch { return null; }
}

// The un-stripped ORIGINAL bytes of an interactive doc, or null if this doc has
// no raw copy (it's a plain static deliverable). Only interactive uploads store a
// .raw.html. This is the source rendered in the sandboxed iframe AND the source
// the reviewed download is rebuilt from — never the live post-JS DOM.
async function readRawHtml(id) {
  if (!isValidDocId(id)) return null;
  const file = path.join(DOCS_DIR, `${id}.raw.html`);
  if (!file.startsWith(DOCS_DIR + path.sep)) return null; // defense in depth
  try { return await readFile(file, 'utf8'); } catch { return null; }
}

// Whether an interactive raw copy exists for this doc (drives the viewer's choice
// between the inert inline path and the sandboxed-iframe path).
async function docHasRaw(id) {
  if (!isValidDocId(id)) return false;
  const file = path.join(DOCS_DIR, `${id}.raw.html`);
  if (!file.startsWith(DOCS_DIR + path.sep)) return false;
  return access(file, fsConstants.F_OK).then(() => true).catch(() => false);
}

// Coarse legacy cleanup of obvious scripts, handlers and javascript: URLs.
// This is NOT an HTML sanitizer or a guarantee that a downloaded file is inert.
// Viewer isolation is enforced separately at the parsed-DOM import boundary and
// by the opaque-origin interactive iframe. Exports remain untrusted HTML.
//
// Collapse the HTML entities an attribute value can hide a scheme behind
// (&#106;avascript:, &#x6a;…, &Tab;/&NewLine; inside the scheme) so the
// javascript:-URL check sees the string the browser would actually resolve.
function decodeAttrEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&Tab;/gi, '\t').replace(/&NewLine;/gi, '\n')
    .replace(/&colon;/gi, ':');
}

// Does this HTML contain active content (scripts / inline handlers / javascript:
// URLs)? Uses the SAME signals stripActiveContent scrubs, so "hasActiveContent"
// is exactly "stripActiveContent would change something". A doc that trips this
// is an INTERACTIVE doc: we keep its un-stripped original (docs/<id>.raw.html) and
// render it in a sandboxed iframe so its own JS can run, contained. A doc that
// doesn't is a plain styled deliverable and takes the existing inert render path.
function hasActiveContent(html) {
  const s = String(html);
  if (/<script\b/i.test(s)) return true;
  if (/[\s/"']on[a-z]+\s*=/i.test(s)) return true;
  // javascript: in href/src, entity-encoding included (mirror the scrub's decode).
  const jsUrl = /(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  let m;
  while ((m = jsUrl.exec(s)) !== null) {
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    if (/^\s*javascript:/i.test(decodeAttrEntities(val))) return true;
  }
  return false;
}

function stripActiveContent(html) {
  return String(html)
    // whole <script> … </script> blocks (incl. attributes, any casing)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    // self-closing / unterminated <script …> just in case
    .replace(/<script\b[^>]*\/?>/gi, '')
    // inline event handlers. The char before `on…` may be whitespace OR any of
    // the separators HTML treats as an attribute boundary (/, unclosed quote),
    // so match [\s/"'] not just \s — this catches `<img/onerror=…>`.
    .replace(/[\s/"']on[a-z]+\s*=\s*"[^"]*"/gi, ' ')
    .replace(/[\s/"']on[a-z]+\s*=\s*'[^']*'/gi, ' ')
    .replace(/[\s/"']on[a-z]+\s*=\s*[^\s>]+/gi, ' ')
    // javascript: URLs in href/src — decode entities in the value first so
    // `&#106;avascript:` and friends are caught, not just the literal scheme.
    .replace(/(href|src)\s*=\s*"([^"]*)"/gi, (m, attr, val) =>
      /^\s*javascript:/i.test(decodeAttrEntities(val)) ? `${attr}="#"` : m)
    .replace(/(href|src)\s*=\s*'([^']*)'/gi, (m, attr, val) =>
      /^\s*javascript:/i.test(decodeAttrEntities(val)) ? `${attr}='#'` : m)
    .replace(/(href|src)\s*=\s*([^\s"'>]+)/gi, (m, attr, val) =>
      /^\s*javascript:/i.test(decodeAttrEntities(val)) ? `${attr}="#"` : m);
}

// List the deliverables available in docs/ (their <id> stems). Config/asset files
// are ignored; only *.html with a valid id is returned, newest-first by name.
async function listDocs() {
  let entries;
  try { entries = await readdir(DOCS_DIR, { withFileTypes: true }); } catch { return []; }
  return entries
    // .raw.html is the interactive original that shadows <id>.html — not a doc of
    // its own, so exclude it (else it would list as a phantom "<id>.raw").
    .filter((e) => e.isFile() && e.name.endsWith('.html') && !e.name.endsWith('.raw.html'))
    .map((e) => e.name.slice(0, -'.html'.length))
    .filter((id) => isValidDocId(id))
    .sort();
}

// Parse metadata only: no DOM execution, resource fetching, or imported markup.
// HTML5 raw-text contexts/entities must agree with the browser's document.title.
function docTitle(html, id) {
  const tree = parse(html);
  let found = null;
  const stack = [tree];
  while (stack.length) {
    const node = stack.pop();
    if (node.tagName === 'title' && node.namespaceURI === 'http://www.w3.org/1999/xhtml') { found = node; break; }
    const children = node.childNodes || [];
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  const title = (found?.childNodes || []).filter(node => node.nodeName === '#text').map(node => node.value).join('')
    .replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 300).replace(/[\uD800-\uDBFF]$/, '');
  return title || id;
}

// Assets that a deliverable references (banner images, etc.) are stored flat in
// docs/assets/ and served read-only from /docs/assets. An asset filename is a
// bare basename — no directory parts, no traversal, and an image extension only.
// We intentionally keep the namespace shared (not per-doc): filenames are global,
// which is simplest and matches how the doc's own <img src> basenames resolve.
const ASSET_NAME = /^[A-Za-z0-9._-]+\.(png|jpe?g|gif|svg|webp|avif|ico|bmp)$/i;
const isValidAssetName = (name) =>
  typeof name === 'string' && name.length > 0 && name.length <= 128 &&
  ASSET_NAME.test(name) && !name.includes('/') && !name.includes('\\') &&
  name !== '.' && name !== '..';
const MAX_ASSET_BYTES = LIMITS.MAX_DOC_BYTES; // reuse the per-file cap for images

// The basenames already present in docs/assets/ — so the client only asks the
// user for images we don't already hold.
async function listAssets() {
  const dir = path.join(DOCS_DIR, 'assets');
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && isValidAssetName(e.name)).map((e) => e.name);
  } catch { return []; }
}

// Optional per-doc config (docs/<id>.config.json). Kept out of the HTML so
// formatters can't strip block-grouping markers. Currently: { groups: [selector] }.
// Missing/invalid config is not an error — grouping just defaults to none.
async function readDocConfig(id) {
  if (!isValidDocId(id)) return {};
  const file = path.join(DOCS_DIR, `${id}.config.json`);
  if (!file.startsWith(DOCS_DIR + path.sep)) return {};
  try {
    const cfg = JSON.parse(await readFile(file, 'utf8'));
    const groups = Array.isArray(cfg.groups) ? cfg.groups.filter((s) => typeof s === 'string') : [];
    return { groups };
  } catch { return {}; }
}

export function createApp(db, opts = {}) {
  const app = express();
  app.set('trust proxy', true); // behind Fly's proxy; needed for correct client IP
  // Body limit tracks the file-size cap plus headroom for JSON overhead, so a
  // paste up to MAX_DOC_BYTES isn't rejected by the parser before our own check.
  app.use(express.json({ limit: 24 * 1024 * 1024 }));
  app.use((error,req,res,next)=>{if(error?.type==='entity.too.large')return res.status(413).json({error:'bundle_too_large'});if(error instanceof SyntaxError&&error.status===400)return res.status(400).json({error:'invalid_json'});next(error);});

  const noStore = (res) => res.setHeader('Cache-Control', 'no-store');

  // Guardrails: identify caller (owner vs guest) on every request, then apply
  // per-IP rate limits to the API route groups. `now` is injectable for tests.
  //
  // identify() MUST run BEFORE express.static — owner promotion happens here:
  // opening `/?key=…` (or `/viewer.html?…&key=…`) sets the mmw_owner cookie. If
  // static served first, those navigations (they match index.html / viewer.html)
  // would terminate before identify ran, and the owner cookie would NEVER be set —
  // the visitor stays a guest and every owner-only action (e.g. changing link
  // access) 403s. So: json → identify → static.
  const { identify, readLimiter, writeLimiter, uploadLimiter } = makeGuardrails({ now: opts.now });
  const machines = machineAuth(db);
  const imports = documentImports(db,DOCS_DIR,{stripActiveContent,checkCapacity(req){if(req.caller.isOwner||req.caller.machine)return;const n=countDocsOwnedBy(db,req.caller.token);if(n>=LIMITS.GUEST_DOC_LIMIT)throw Object.assign(new Error(),{status:403,code:'guest_doc_limit'});if(n===0&&countGuestOwners(db)>=LIMITS.MAX_GUEST_OWNERS)throw Object.assign(new Error(),{status:503,code:'capacity_full'});}});
  const instanceId = machineInstance(db, opts.instanceId);
  app.use((req,res,next)=>req.headers.authorization ? next() : identify(req,res,next));
  app.use(machines.middleware);
  app.get('/api/instance', (_req,res)=>res.json({product:'marginroom',protocolVersion:1,instanceId,ready:true}));
  app.post('/api/imports', uploadLimiter, (req,res)=>{
    try {req.canManage=id=>machines.manages(req,id);const result=imports.import(req,req.body);res.json({schemaVersion:1,document:result.doc,series:result.series,previous:result.previous,hash:result.hash,reused:result.reused,external:result.external});}
    catch(e){res.status(e.status||500).json({error:e.code||'import_failed'});}
  });
  app.post('/api/machine/pair',(req,res)=>{if(!req.caller.machine||req.caller.doc)return res.status(403).json({error:'machine_pairing_required'});res.json(machines.issue());});
  app.post('/api/machine/delegate',(req,res)=>{
    const doc=req.body?.doc;if(!doc||!machines.manages(req,doc))return res.status(403).json({error:'not_your_doc'});
    res.json(machines.issue(req.caller.token,doc));
  });
  app.post('/api/machine/revoke',(req,res)=>{
    const hash=digest(String(req.body?.token||''));
    db.prepare('UPDATE machine_credentials SET revoked=1 WHERE hash=? AND principal=?').run(hash,req.caller.token);res.json({ok:true});
  });
  app.post('/api/management/handoff',(req,res)=>{
    const doc=req.body?.doc;if(!doc||!machines.manages(req,doc))return res.status(403).json({error:'not_your_doc'});
    const token=randomUUID()+randomUUID();db.prepare('INSERT INTO management_handoffs VALUES(?,?,?)').run(digest(token),doc,Date.now()+60000);res.json({token});
  });
  app.post('/api/management/claim',(req,res)=>{
    if(req.caller.machine)return res.status(403).json({error:'browser_required'});
    const claim=db.transaction(()=>{const hash=digest(String(req.body?.token||''));const row=db.prepare('SELECT * FROM management_handoffs WHERE hash=? AND expires>?').get(hash,Date.now());if(!row)return null;
      db.prepare('DELETE FROM management_handoffs WHERE hash=?').run(hash);db.prepare('INSERT OR IGNORE INTO document_grants VALUES(?,?)').run(row.doc,req.caller.token);return row.doc;}).immediate();
    if(!claim)return res.status(403).json({error:'handoff_expired_or_used'});res.json({document:claim});
  });
  app.get('/api/document-series/:id',(req,res)=>{
    const current=imports.get(req.params.id);if(!current||!machines.manages(req,current.doc))return res.status(403).json({error:'not_your_doc'});
    res.json({series:current.series,versions:db.prepare('SELECT doc,previous,created FROM imported_documents WHERE series=? ORDER BY rowid').all(current.series).filter(v=>machines.manages(req,v.doc))});
  });
  app.post('/api/versions-locate',async(req,res)=>{
    const {record:recordId,target}=req.body||{};const record=getSuggestion(db,recordId);if(!record||!machines.manages(req,record.doc_id)||!machines.manages(req,target))return res.status(403).json({error:'not_your_doc'});
    const from=imports.get(record.doc_id),to=imports.get(target);if(!from||!to||from.series!==to.series)return res.status(400).json({error:'unrelated_versions'});
    const source=await readDocHtml(record.doc_id),html=await readDocHtml(target);
    res.json({sourceVersion:record.doc_id,targetVersion:target,record:record.id,...await locateAcross(db,record,source,{doc:target,html})});
  });
  // Imports are visible only after their synchronous SQLite publication commit.
  app.use((req,res,next)=>{const id=/^\/api\/(?:doc|raw|doc-meta|suggestions)\/(review-[a-f0-9-]+)$/.exec(req.path)?.[1];if(id&&!imports.get(id))return res.status(404).json({error:'doc_not_found'});next();});
  app.use('/bundles/:doc' , (req,res,next)=>{
    if(!imports.get(req.params.doc))return res.sendStatus(404);
    res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'");res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Access-Control-Allow-Origin','*');
    express.static(path.join(imports.root,req.params.doc),{dotfiles:'deny',index:false,redirect:false})(req,res,next);
  });
  app.use(express.static(PUBLIC_DIR));
  app.get('/api/whoami', (req, res) => {
    noStore(res);
    res.json({ isOwner: !!req.caller?.isOwner, docLimit: LIMITS.GUEST_DOC_LIMIT });
  });
  // Serve document assets (banner images, etc.) referenced by deliverable HTML.
  // Read-only static files under docs/assets — never the .html sources themselves
  // (those go through /api/doc so overlays apply).
  app.use('/docs/assets', express.static(path.join(DOCS_DIR, 'assets'), {
    setHeaders(res) {
      // SVG (or image-extension HTML) is untrusted active content when opened as
      // a document. Preserve image rendering, but never grant it our origin or JS.
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }));

  // GET /api/assets -> { assets: [name, ...] }  (basenames already on the box, so
  // the landing page only asks the user for images we don't already have).
  app.get('/api/assets', readLimiter, async (_req, res) => {
    noStore(res);
    res.json({ assets: await listAssets() });
  });

  // POST /api/upload-asset { name, dataBase64 } -> { ok, name }
  // Stores an image the uploaded doc references into docs/assets/ (shared, flat).
  // Owner or guest may add assets (they're inert files, served static); we cap
  // size, allow only image extensions, and reject any non-basename to prevent
  // traversal. Not clobbered if it already exists — same name = same image here.
  app.post('/api/upload-asset', uploadLimiter, async (req, res) => {
    const { name, dataBase64 } = req.body || {};
    if (!isValidAssetName(name)) return res.status(400).json({ error: 'invalid_asset_name' });
    if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
      return res.status(400).json({ error: 'empty_asset' });
    }
    let buf;
    try { buf = Buffer.from(dataBase64, 'base64'); } catch { buf = null; }
    if (!buf || buf.length === 0) return res.status(400).json({ error: 'empty_asset' });
    if (buf.length > MAX_ASSET_BYTES) {
      return res.status(413).json({ error: 'too_large', maxBytes: MAX_ASSET_BYTES });
    }
    const dir = path.join(DOCS_DIR, 'assets');
    const file = path.join(dir, name);
    if (!file.startsWith(dir + path.sep)) return res.status(400).json({ error: 'invalid_asset_name' });
    // Already have it? Treat as success — the doc's <img> will resolve either way.
    if (await access(file, fsConstants.F_OK).then(() => true).catch(() => false)) {
      noStore(res);
      return res.json({ ok: true, name, existed: true });
    }
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(file, buf);
    } catch {
      return res.status(500).json({ error: 'write_failed' });
    }
    noStore(res);
    res.json({ ok: true, name });
  });

  // GET /api/docs -> { docs: [id, ...] }  (for the landing page)
  // Scoped per viewer: the owner sees every doc; a guest sees only docs they
  // created PLUS any doc with no owner row (the seed/demo docs, public to all).
  // This keeps the hosted site from being one shared bucket — a guest's uploads
  // aren't visible to other guests, and the owner's work isn't listed publicly.
  app.get('/api/docs', readLimiter, async (req, res) => {
    noStore(res);
    const all = (await listDocs()).filter(id=>!/^review-[a-f0-9-]+$/.test(id)||imports.get(id));
    const { token, isOwner } = req.caller;
    if (req.query.scope === 'mine') {
      // Unlike the legacy discovery list, seeds and admin-accessible documents
      // are not implicitly owned. Select only this token's persisted owner rows.
      const owned = new Set(db.prepare('SELECT doc_id FROM doc_owners WHERE owner_token = ?').all(token).map(row => row.doc_id));
      for(const row of db.prepare('SELECT doc FROM document_grants WHERE principal=?').all(token))owned.add(row.doc);
      const metadata = [];
      for (const id of all.filter(id => owned.has(id))) {
        const html = await readDocHtml(id);
        if (html != null) {
          const titleHtml = await readRawHtml(id) ?? html;
          metadata.push(docMetadata(req, id, titleHtml));
        }
      }
      return res.json({ docs: metadata.map(entry => entry.id), metadata });
    }
    if (isOwner) return res.json({ docs: all });
    const owners = ownerMap(db);
    const visible = all.filter((id) => !(id in owners) || owners[id] === token);
    res.json({ docs: visible });
  });

  // Exact-link lookup has the same public reading policy and ID bounds as
  // /api/doc. It does not add the document to another caller's mine listing.
  app.get('/api/doc-meta/:id', readLimiter, async (req, res) => {
    noStore(res);
    const { id } = req.params;
    if (!isValidDocId(id)) return res.status(400).json({ error: 'invalid_doc_id' });
    const html = await readDocHtml(id);
    if (html == null) return res.status(404).json({ error: 'doc_not_found' });
    const titleHtml = await readRawHtml(id) ?? html;
    res.json(docMetadata(req, id, titleHtml));
  });

  // Summaries use existing persisted timestamps, never file modification times.
  // Do not expose even discussion activity to callers denied the suggestions API.
  const activityQuery = db.prepare(`
    SELECT ts FROM (
      SELECT created_at AS ts FROM doc_owners WHERE doc_id = @id
      UNION ALL SELECT updated_at FROM documents WHERE doc_id = @id
      UNION ALL SELECT ts FROM document_versions WHERE doc_id = @id
      UNION ALL SELECT created_at FROM suggestions WHERE doc_id = @id AND @seeSuggestions
      UNION ALL SELECT r.created_at FROM suggestion_replies r
        JOIN suggestions s ON s.id = r.parent_id WHERE s.doc_id = @id AND @seeSuggestions
    ) WHERE julianday(ts) IS NOT NULL ORDER BY julianday(ts) DESC LIMIT 1
  `);
  const pendingQuery = db.prepare("SELECT count(*) AS count FROM suggestions WHERE doc_id = ? AND status = 'open'");
  // Only the title label reads source HTML: prefer the retained upload original,
  // since legacy scrubbing can corrupt literal handler-looking title text.
  // docTitle extracts inert bounded text; no source execution or live form reads.
  function docMetadata(req, id, titleHtml) {
    const maySeeSuggestions = canSuggestDoc(req, id);
    const activity = activityQuery.get({ id, seeSuggestions: Number(maySeeSuggestions) });
    const time = activity ? Date.parse(activity.ts) : NaN;
    return {
      id, title: docTitle(titleHtml, id),
      canDelete: ownsDoc(req, id),
      // Admins can manage every document, but own only their actual owner rows.
      isOwned: getDocOwner(db, id) === req.caller.token,
      isManaged: machines.manages(req,id),
      isAdmin: !!req.caller.isOwner,
      pendingCount: maySeeSuggestions ? pendingQuery.get(id).count : null,
      activityAt: Number.isFinite(time) ? new Date(time).toISOString() : null,
    };
  }

  // POST /api/upload { id, html, overwrite? } -> { ok, id }
  // Writes a new document to docs/<id>.html. HTML is trusted styling but we
  // strip active content (scripts/handlers/js: URLs) so the stored file is inert.
  app.post('/api/upload', uploadLimiter, async (req, res) => {
    const { id, html, overwrite } = req.body || {};
    const { token, isOwner } = req.caller;
    if (!isValidDocId(id)) return res.status(400).json({ error: 'invalid_doc_id' });
    if (typeof html !== 'string' || html.trim().length === 0) {
      return res.status(400).json({ error: 'empty_html' });
    }
    if (Buffer.byteLength(html, 'utf8') > MAX_DOC_BYTES) {
      return res.status(413).json({ error: 'too_large', maxBytes: MAX_DOC_BYTES });
    }
    // Must look like HTML (a tag somewhere) — guards against pasted plain text.
    if (!/<[a-z!][\s\S]*>/i.test(html)) return res.status(400).json({ error: 'not_html' });

    const file = path.join(DOCS_DIR, `${id}.html`);
    if (!file.startsWith(DOCS_DIR + path.sep)) return res.status(400).json({ error: 'invalid_doc_id' });

    const existsBefore = await access(file, fsConstants.F_OK).then(() => true).catch(() => false);

    // Refuse to clobber an existing doc unless the caller opts in — an accidental
    // re-upload would otherwise silently replace a reviewed document (its
    // overlay/suggestions/history in SQLite would then point at different text).
    if (existsBefore && !overwrite) return res.status(409).json({ error: 'doc_exists' });

    // Guardrails: guests are capped to GUEST_DOC_LIMIT docs, and the box holds at
    // most MAX_GUEST_OWNERS distinct guests. The owner (OWNER_KEY) is exempt.
    // Overwriting a doc you already own doesn't consume a new slot.
    if (!isOwner) {
      const ownsThis = getDocOwner(db, id) === token;
      const creatingNew = !existsBefore || !ownsThis;
      if (creatingNew) {
        // Overwriting someone else's doc is not allowed for guests.
        if (existsBefore && !ownsThis) return res.status(403).json({ error: 'not_your_doc' });
        if (countDocsOwnedBy(db, token) >= LIMITS.GUEST_DOC_LIMIT) {
          return res.status(403).json({ error: 'guest_doc_limit', limit: LIMITS.GUEST_DOC_LIMIT });
        }
        // New distinct guest? enforce the global ceiling.
        if (countDocsOwnedBy(db, token) === 0 && countGuestOwners(db) >= LIMITS.MAX_GUEST_OWNERS) {
          return res.status(503).json({ error: 'capacity_full' });
        }
      }
    }

    // Safe legacy single-file creation delegates the exact same bundle validator,
    // publication transaction and ownership path. Preserve caller-selected legacy ID.
    if(!existsBefore){
      try {const bytes=Buffer.from(html);req.canManage=doc=>machines.manages(req,doc);
        imports.import(req,{entry:'document.html',files:[{path:'document.html',data:bytes.toString('base64'),sha256:digest(bytes)}],source:'legacy_'+digest(id)},{id,raw:hasActiveContent(html)});
        return res.json({ok:true,id,interactive:hasActiveContent(html)});
      }catch(e){return res.status(e.status||500).json({error:e.code||'import_failed'});}
    }
    // Legacy explicit overwrite remains a compatibility operation, never used by
    // web/CLI bundle workflows. Do not allow it to destroy a versioned review.
    if(imports.get(id)&&!imports.get(id).source.startsWith('legacy_'))return res.status(409).json({error:'source_changed_use_new_version'});
    if(imports.get(id))imports.forget(id);

    // Interactive doc? Keep the un-stripped ORIGINAL alongside the inert copy.
    // docs/<id>.html is always the scrubbed, safe-to-inline version (fallback +
    // anchoring base); docs/<id>.raw.html is the original with its JS intact,
    // rendered only inside a sandboxed iframe and used to rebuild the download.
    const interactive = hasActiveContent(html);
    const rawFile = path.join(DOCS_DIR, `${id}.raw.html`);
    if (!rawFile.startsWith(DOCS_DIR + path.sep)) return res.status(400).json({ error: 'invalid_doc_id' });
    try {
      await writeFile(file, stripActiveContent(html), 'utf8');
      if (interactive) {
        await writeFile(rawFile, html, 'utf8');
      } else {
        // Overwriting a previously-interactive doc with a static one: drop the
        // now-stale raw copy so it can't be served/rebuilt.
        await rm(rawFile, { force: true }).catch(() => {});
      }
    } catch {
      return res.status(500).json({ error: 'write_failed' });
    }
    // Record ownership (owner docs use the shared 'owner' token).
    setDocOwner(db, id, isOwner ? 'owner' : token, new Date().toISOString());
    noStore(res);
    res.json({ ok: true, id, interactive });
  });

  // DELETE /api/doc/:id — remove a document (file + all SQLite state). Allowed
  // for the owner, or the guest who created it (frees their one slot).
  app.delete('/api/doc/:id', writeLimiter, async (req, res) => {
    const { id } = req.params;
    const { token, isOwner } = req.caller;
    if (!isValidDocId(id)) return res.status(400).json({ error: 'invalid_doc_id' });
    const file = path.join(DOCS_DIR, `${id}.html`);
    if (!file.startsWith(DOCS_DIR + path.sep)) return res.status(400).json({ error: 'invalid_doc_id' });
    const owner = getDocOwner(db, id);
    const exists = await access(file, fsConstants.F_OK).then(() => true).catch(() => false);
    if (!exists && owner == null) return res.status(404).json({ error: 'doc_not_found' });
    if (!ownsDoc(req,id)) return res.status(403).json({ error: 'not_your_doc' });
    await rm(file, { force: true }).catch(() => {});
    await rm(path.join(DOCS_DIR, `${id}.raw.html`), { force: true }).catch(() => {});
    await rm(path.join(DOCS_DIR, `${id}.config.json`), { force: true }).catch(() => {});
    imports.forget(id);
    deleteDocData(db)(id);
    noStore(res);
    res.json({ ok: true, id });
  });

  // GET /api/doc/:id -> { id, baseHtml, overlay, config, hasRaw }
  // hasRaw=true means this is an INTERACTIVE doc with an original kept at
  // <id>.raw.html — the viewer then uses the sandboxed-iframe path (see /api/raw).
  app.get('/api/doc/:id', readLimiter, async (req, res) => {
    const { id } = req.params;
    if (!isValidDocId(id)) return res.status(400).json({ error: 'invalid_doc_id' });
    const baseHtml = await readDocHtml(id);
    if (baseHtml == null) return res.status(404).json({ error: 'doc_not_found' });
    const config = await readDocConfig(id);
    // access = the doc's link-access level; canEdit/canSuggest = what THIS caller
    // may do given that level (the owner/doc-owner always can, a guest per level).
    const access = getDocAccess(db, id);
    const mine = ownsDoc(req, id);
    noStore(res);
    res.json({
      id, baseHtml, overlay: getOverlay(db, id), config, hasRaw: await docHasRaw(id),
      access, isDocOwner: mine,
      canEdit: mine || access === 'edit',
      canSuggest: mine || access !== 'view',
    });
  });

  // GET /api/access/:id -> { access, isDocOwner }   PUT { level } -> { ok, access }
  // The link-access level (view/suggest/edit) is the owner's control over what a
  // guest with the link may do. Reading it is open (the viewer needs it to render
  // the right modes); changing it is restricted to the owner / the doc's owner.
  app.get('/api/access/:id', readLimiter, async (req, res) => {
    const { id } = req.params;
    if (!isValidDocId(id)) return res.status(400).json({ error: 'invalid_doc_id' });
    if (await readDocHtml(id) == null) return res.status(404).json({ error: 'doc_not_found' });
    noStore(res);
    res.json({ access: getDocAccess(db, id), isDocOwner: ownsDoc(req, id) });
  });

  app.put('/api/access/:id', writeLimiter, async (req, res) => {
    const { id } = req.params;
    if (!isValidDocId(id)) return res.status(400).json({ error: 'invalid_doc_id' });
    if (await readDocHtml(id) == null) return res.status(404).json({ error: 'doc_not_found' });
    if (!ownsDoc(req, id)) return res.status(403).json({ error: 'not_your_doc' });
    const level = String(req.body?.level || '');
    if (!ACCESS_LEVELS.includes(level)) return res.status(400).json({ error: 'invalid_access_level' });
    // A doc with no owner row (seed/demo) can't carry a per-doc level. Only the
    // global owner reaches here for those (ownsDoc → isOwner), so record ownership
    // under the shared 'owner' token first, then set the level.
    if (getDocOwner(db, id) == null) setDocOwner(db, id, 'owner', new Date().toISOString());
    setDocAccess(db, id, level);
    noStore(res);
    res.json({ ok: true, access: level });
  });

  // GET /api/raw/:id -> the un-stripped ORIGINAL bytes of an interactive doc, as
  // JSON { id, rawHtml }. This is the ONLY way the viewer gets the runnable HTML,
  // and it deliberately returns JSON (not a navigable text/html document): the raw
  // bytes are attacker-controlled, so we never let them be a top-level page on our
  // origin. The viewer drops them into a sandboxed <iframe srcdoc> (opaque origin),
  // where the doc's JS can run but can't reach our cookies/APIs.
  //   Defense in depth: even the JSON response is marked no-store + nosniff and
  //   carries a CSP sandbox directive, so a browser that somehow renders it as a
  //   document still gets an opaque, script-only-sandboxed context.
  app.get('/api/raw/:id', readLimiter, async (req, res) => {
    const { id } = req.params;
    if (!isValidDocId(id)) return res.status(400).json({ error: 'invalid_doc_id' });
    const rawHtml = await readRawHtml(id);
    if (rawHtml == null) return res.status(404).json({ error: 'no_raw' });
    noStore(res);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', 'sandbox allow-scripts');
    const imported=imports.get(id);
    const resourceBase=imported ? `/bundles/${id}/${imported.entry.split('/').slice(0,-1).join('/')}${imported.entry.includes('/')?'/':''}` : null;
    res.json({ id, rawHtml, resourceBase });
  });

  // POST /api/snapshot/:id { html } -> { ok, html }
  // The static "edited snapshot" download for interactive docs. The viewer asks the
  // sandboxed frame to serialize its LIVE (post-JS) DOM and posts that string here.
  // That string is ATTACKER-CONTROLLED (the frame ran untrusted JS and could have
  // planted a <script>/on*=/javascript: that would fire when the user later opens
  // the downloaded file OUTSIDE the sandbox). Apply the same coarse cleanup as
  // upload, but do not promise an inert download: regex cleanup is not a complete
  // HTML sanitizer. Exported HTML must still be treated as untrusted. No stored
  // state is touched by this endpoint.
  app.post('/api/snapshot/:id', writeLimiter, async (req, res) => {
    const { id } = req.params;
    if (!isValidDocId(id)) return res.status(400).json({ error: 'invalid_doc_id' });
    // Only snapshot docs that exist and actually have a runnable original — a static
    // doc has no live frame to snapshot, so there's nothing to sanitize here.
    if (!(await docHasRaw(id))) return res.status(404).json({ error: 'no_raw' });
    const { html } = req.body || {};
    if (typeof html !== 'string' || html.length === 0) return res.status(400).json({ error: 'invalid_html' });
    if (Buffer.byteLength(html, 'utf8') > MAX_DOC_BYTES) {
      return res.status(413).json({ error: 'too_large', maxBytes: MAX_DOC_BYTES });
    }
    const clean = stripActiveContent(html);
    noStore(res);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.json({ ok: true, html: clean });
  });

  // POST /api/patch-download/:id { edits:[{from,to}] } -> { ok, html, applied, unmatched }
  // The "original interactive" download for a self-unpacking bundle. The bundle
  // renders its visible text from gzip+base64 payload blobs, so editing the DOM
  // doesn't change the file. This decodes those blobs, does an EXACT string swap
  // (from -> to) inside them, re-encodes, and returns the patched file — still fully
  // interactive, now carrying the reviewer's edits. Blobs without the target text
  // are left byte-for-byte untouched; edits whose `from` isn't found come back in
  // `unmatched` (the client can fall back or warn). We introduce no executable
  // content: only the doc's own payload text changes.
  app.post('/api/patch-download/:id', writeLimiter, async (req, res) => {
    const { id } = req.params;
    if (!isValidDocId(id)) return res.status(400).json({ error: 'invalid_doc_id' });
    const rawHtml = await readRawHtml(id);
    if (rawHtml == null) return res.status(404).json({ error: 'no_raw' });
    const edits = Array.isArray(req.body?.edits) ? req.body.edits : [];
    // Bound the request: cap edit count and per-string length (defense vs abuse).
    const safeEdits = edits
      .filter((e) => e && typeof e.from === 'string' && typeof e.to === 'string')
      .slice(0, 5000)
      .map((e) => ({ from: e.from.slice(0, MAX_TEXT), to: e.to.slice(0, MAX_TEXT) }));
    let result;
    try { result = patchSource(rawHtml, safeEdits); }
    catch { return res.status(500).json({ error: 'patch_failed' }); }
    noStore(res);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.json({ ok: true, html: result.html, applied: result.applied, unmatched: result.unmatched });
  });

  // Owner-only gate for the review DECISIONS on a doc (direct edit, restore,
  // accept/reject). Suggesting stays open so any reviewer can propose changes;
  // applying them is the owner's call. The global owner (OWNER_KEY) may act on
  // any doc; a guest may act only on a doc they created (owner row === their
  // token). Docs with no owner row (seed/demo) are owner-only. Mirrors the
  // check already used by DELETE /api/doc/:id.
  function ownsDoc(req, id) {
    if (req.caller?.isOwner) return true;
    return machines.manages(req,id);
  }

  // May THIS caller directly edit the doc's text? The owner/doc-owner always may;
  // a plain guest may only when the doc's link-access level is 'edit'.
  function canEditDoc(req, id) {
    return ownsDoc(req, id) || getDocAccess(db, id) === 'edit';
  }

  // May THIS caller propose suggestions? Everyone except a guest on a 'view'-only
  // doc (the owner/doc-owner is never blocked).
  function canSuggestDoc(req, id) {
    if(req.caller?.machine && req.caller.doc===id)return true;
    return ownsDoc(req, id) || getDocAccess(db, id) !== 'view';
  }

  const revisions = revisionService(db, {
    readSource(id) { try { return readFileSync(path.join(DOCS_DIR, `${id}.html`), 'utf8'); } catch { return null; } },
    readConfig(id) { try { return JSON.parse(readFileSync(path.join(DOCS_DIR, `${id}.config.json`), 'utf8')); } catch { return {}; } },
  });
  app.get('/api/revision/:id', readLimiter, (req,res,next) => {
    const {id}=req.params;
    if(!isValidDocId(id))return res.status(400).json({error:'invalid_doc_id'});
    if(!canSuggestDoc(req,id))return res.status(403).json({error:'view_only'});
    try { noStore(res);res.json(revisions.snapshot(id,req.query.anchor,req.caller.token)); }
    catch(e){if(e instanceof RevisionError)return res.status(e.status).json(e.response);next(e)}
  });
  app.post('/api/revision/:id', writeLimiter, (req,res,next) => {
    const {id}=req.params;
    if(!isValidDocId(id))return res.status(400).json({error:'invalid_doc_id'});
    if(!canSuggestDoc(req,id))return res.status(403).json({error:'suggest_not_allowed'});
    try { noStore(res);res.json(revisions.reconcile(id,req.caller.token,req.body||{})); }
    catch(e){if(e instanceof RevisionError)return res.status(e.status).json(e.response);next(e)}
  });

  // POST /api/edit/:id { anchor, text } -> { ok, overlay }
  app.post('/api/edit/:id', writeLimiter, async (req, res) => {
    const { id } = req.params;
    if (!isValidDocId(id)) return res.status(400).json({ error: 'invalid_doc_id' });
    if (await readDocHtml(id) == null) return res.status(404).json({ error: 'doc_not_found' });
    // Direct editing: the owner/doc-owner always, or a guest when access === 'edit'.
    if (!canEditDoc(req, id)) return res.status(403).json({ error: 'edit_not_allowed' });
    const { anchor, text } = req.body || {};
    if (typeof anchor !== 'string' || !anchor || anchor.length > 200) {
      return res.status(400).json({ error: 'invalid_anchor' });
    }
    if (typeof text !== 'string' || text.length > MAX_TEXT) {
      return res.status(400).json({ error: 'invalid_text' });
    }
    const ts = new Date().toISOString();
    const overlay = setBlockAndSnapshot(db)(id, anchor, escapeText(text), ts, null);
    noStore(res);
    res.json({ ok: true, overlay });
  });

  // GET /api/versions/:id -> { versions: [{id, ts, label}] }
  app.get('/api/versions/:id', readLimiter, (req, res) => {
    const { id } = req.params;
    if (!isValidDocId(id)) return res.status(400).json({ error: 'invalid_doc_id' });
    noStore(res);
    res.json({ versions: listVersions(db, id) });
  });

  // GET /api/version/:id/:versionId -> { id, ts, label, overlay }  (preview)
  app.get('/api/version/:id/:versionId', readLimiter, (req, res) => {
    const { id, versionId } = req.params;
    if (!isValidDocId(id)) return res.status(400).json({ error: 'invalid_doc_id' });
    const v = getVersion(db, id, Number(versionId));
    if (!v) return res.status(404).json({ error: 'version_not_found' });
    noStore(res);
    res.json({ id: v.id, ts: v.ts, label: v.label, overlay: v.overlay });
  });

  // POST /api/restore/:id { versionId } -> { ok, overlay }
  app.post('/api/restore/:id', writeLimiter, (req, res) => {
    const { id } = req.params;
    if (!isValidDocId(id)) return res.status(400).json({ error: 'invalid_doc_id' });
    if (!ownsDoc(req, id)) return res.status(403).json({ error: 'not_your_doc' });
    const versionId = Number(req.body?.versionId);
    if (!Number.isInteger(versionId)) return res.status(400).json({ error: 'invalid_version_id' });
    const overlay = restoreVersion(db)(id, versionId, new Date().toISOString());
    if (overlay == null) return res.status(404).json({ error: 'version_not_found' });
    noStore(res);
    res.json({ ok: true, overlay });
  });

  // --- suggestions (tracked changes; owner can suggest + accept/reject) ---

  // GET /api/suggestions/:id -> { suggestions: [...] }  (open only)
  app.get('/api/suggestions/:id', readLimiter, async (req, res) => {
    const { id } = req.params;
    if (!isValidDocId(id)) return res.status(400).json({ error: 'invalid_doc_id' });
    if (await readDocHtml(id) == null) return res.status(404).json({ error: 'doc_not_found' });
    // A view-only link hides change requests from guests: if the owner locked the
    // doc to 'view', a guest must not be able to read others' suggestions either
    // (they can't make them, and the owner may have chosen 'view' precisely to
    // keep a client from seeing pending edits). Owner/doc-owner always see them.
    if (!canSuggestDoc(req, id)) return res.status(403).json({ error: 'view_only' });
    const status = req.query.status ?? 'open';
    if (!['open', 'all', 'accepted', 'rejected', 'stale', 'withdrawn'].includes(status)) return res.status(400).json({ error: 'invalid_status' });
    noStore(res);
    const html = await readDocHtml(id);
    res.json({ suggestions: listSuggestions(db, id, status).map(s => s.kind==='rewrite'&&(s.status==='open'||s.status==='stale') ? {...s,invalid_reason:revisions.invalidReason(id,s,html)} : s) });
  });

  // POST /api/suggest/:id { anchor, quote, body, kind, author } -> { ok, suggestion }
  app.post('/api/suggest/:id', writeLimiter, async (req, res) => {
    const { id } = req.params;
    if (!isValidDocId(id)) return res.status(400).json({ error: 'invalid_doc_id' });
    const originalHtml=await readDocHtml(id);
    if (originalHtml == null) return res.status(404).json({ error: 'doc_not_found' });
    // Suggesting is open to any reviewer EXCEPT on a view-only doc (owner's choice).
    if (!canSuggestDoc(req, id)) return res.status(403).json({ error: 'suggest_not_allowed' });
    const { anchor, quote, body, kind, author, spanOcc, baseText, rangeStart, rangeEnd, requestId } = req.body || {};
    const hasRange = rangeStart !== undefined || rangeEnd !== undefined;
    if (hasRange) {
      if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd) ||
          typeof baseText !== 'string' || baseText.length > MAX_TEXT || rangeStart < 0 ||
          rangeEnd < rangeStart || rangeEnd > baseText.length || typeof quote !== 'string' ||
          quote !== baseText.slice(rangeStart, rangeEnd) || (typeof anchor === 'string' && anchor.startsWith('m:')) ||
          (spanOcc != null && spanOcc !== -1)) {
        return res.status(400).json({ error: 'invalid_range' });
      }
      // Offsets are UTF-16 code units but must not bisect a surrogate pair.
      const splitsPair = (i) => i > 0 && i < baseText.length && /[\uD800-\uDBFF]/.test(baseText[i - 1]) && /[\uDC00-\uDFFF]/.test(baseText[i]);
      if (splitsPair(rangeStart) || splitsPair(rangeEnd)) return res.status(400).json({ error: 'invalid_range' });
    }
    if (requestId !== undefined && (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(requestId))) {
      return res.status(400).json({ error: 'invalid_request_id' });
    }
    if (kind !== 'rewrite' && kind !== 'comment') return res.status(400).json({ error: 'invalid_kind' });
    // A multi-block anchor ("m:a1,a2,…") packs several block anchors, so it needs a
    // larger cap than a single anchor. 1000 chars fits ~14 sha256 anchors — well
    // above the client's 8-block rewrite cap.
    if (typeof anchor !== 'string' || !anchor || anchor.length > 1000) return res.status(400).json({ error: 'invalid_anchor' });
    if (typeof body !== 'string' || (body.length === 0 && !(hasRange && kind === 'rewrite' && rangeEnd > rangeStart)) || body.length > MAX_TEXT) return res.status(400).json({ error: 'invalid_body' });
    // span_occ: -2 = multi-block whole-paragraph rewrite (anchor is an "m:" list;
    // body is blank-line-separated paragraphs re-split at accept). -1 = whole block.
    // >=0 = replace the Nth occurrence of `quote`. A span-level rewrite MUST carry a
    // non-empty quote to locate the phrase.
    let span_occ = -1;
    if (spanOcc != null) {
      if (!Number.isInteger(spanOcc) || spanOcc < -2) return res.status(400).json({ error: 'invalid_span' });
      span_occ = spanOcc;
    }
    if (span_occ >= 0 && kind === 'rewrite' && !(typeof quote === 'string' && quote.length > 0)) {
      return res.status(400).json({ error: 'span_requires_quote' });
    }
    // A multi-block rewrite must actually carry a packed anchor list to apply to.
    if (span_occ === -2 && kind === 'rewrite' && !anchor.startsWith('m:')) {
      return res.status(400).json({ error: 'multi_requires_list' });
    }
    // base_text/quote/body are UNTRUSTED (reviewers). We escape body+quote+author
    // for display. base_text must be escaped too because span replacement happens
    // against the escaped overlay text (overlay is stored escaped), so all three
    // sides — needle (quote), haystack (base_text), overlay — share one encoding.
    const requestPayload = JSON.stringify(Object.keys(req.body).filter((key) => key !== 'requestId').sort().map((key) => [key, req.body[key]]));
    if (requestId !== undefined) {
      const prior = findSuggestionRequest(db, id, req.caller.token, requestId);
      if (prior) {
        if (prior.request_payload !== requestPayload) return res.status(409).json({ error: 'request_id_conflict' });
        noStore(res);
        return res.json({ ok: true, suggestion: getSuggestion(db, prior.id), replayed: true });
      }
    }
    if(kind==='rewrite'){
      const record={anchor,kind,span_occ,range_start:hasRange?rangeStart:null,range_end:hasRange?rangeEnd:null,quote:escapeText(String(quote||'')),base_text:escapeText(String(baseText||''))};
      try{
        revisions.validateLegacy(id,record,originalHtml);
        const current=getOverlay(db,id)[anchor];
        if(hasRange&&current&&current.text!==record.base_text)return res.status(409).json({error:'span_stale'});
        revisions.checkLegacyOverlap(id,record,originalHtml);
      }catch(e){if(e instanceof RevisionError)return res.status(e.status).json(e.response);throw e}
    }
    const suggestion = addSuggestion(db, {
      id: randomUUID(),
      range_start: hasRange ? rangeStart : null,
      range_end: hasRange ? rangeEnd : null,
      request_id: requestId ?? null,
      request_caller: req.caller.token,
      request_payload: requestId !== undefined ? requestPayload : null,
      doc_id: id,
      anchor,
      quote: escapeText(String(quote || '').slice(0, MAX_TEXT)),
      body: escapeText(body),
      kind,
      author: escapeText(String(author || 'reviewer').slice(0, 120)),
      created_at: new Date().toISOString(),
      span_occ,
      base_text: escapeText(String(baseText || '').slice(0, MAX_TEXT)),
    });
    db.prepare('UPDATE suggestions SET source_hash=? WHERE id=?').run(createHash('sha256').update(originalHtml).digest('hex'),suggestion.id);
    noStore(res);
    res.json({ ok: true, suggestion });
  });

  // Replies follow the existing document-scoped singular mutation route family.
  app.post('/api/suggest/:id/:sid/replies', writeLimiter, async (req, res) => {
    const { id, sid } = req.params;
    if (!isValidDocId(id)) return res.status(400).json({ error: 'invalid_doc_id' });
    if (await readDocHtml(id) == null) return res.status(404).json({ error: 'doc_not_found' });
    if (!canSuggestDoc(req, id)) return res.status(403).json({ error: 'suggest_not_allowed' });
    const s = getSuggestion(db, sid);
    if (!s || s.doc_id !== id) return res.status(404).json({ error: 'suggestion_not_found' });
    const { body, author, requestId } = req.body || {};
    if (typeof body !== 'string' || !body.trim() || body.length > MAX_TEXT) return res.status(400).json({ error: 'invalid_body' });
    if (requestId !== undefined && (typeof requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(requestId))) return res.status(400).json({ error: 'invalid_request_id' });
    const replyId = requestId === undefined ? randomUUID() : createHash('sha256').update(JSON.stringify([id, sid, req.caller.token, requestId])).digest('hex');
    const storedBody = escapeText(body), storedAuthor = escapeText(String(author || 'reviewer').slice(0, 120));
    const prior = s.replies.find(reply => reply.id === replyId);
    if (prior) {
      if (prior.body !== storedBody || prior.author !== storedAuthor) return res.status(409).json({ error: 'request_id_conflict' });
      noStore(res);
      return res.json({ ok: true, replayed: true, reply: prior, suggestion: s });
    }
    const reply = addSuggestionReply(db, {
      id: replyId, parent_id: sid, body: storedBody,
      author: storedAuthor, created_at: new Date().toISOString(),
    });
    noStore(res);
    res.json({ ok: true, reply, suggestion: getSuggestion(db, sid) });
  });

  // POST /api/suggest/:id/:sid/accept -> { ok, overlay }
  app.post('/api/suggest/:id/:sid/accept', writeLimiter, async (req, res) => {
    const { id, sid } = req.params;
    if (!isValidDocId(id)) return res.status(400).json({ error: 'invalid_doc_id' });
    if (!ownsDoc(req, id)) return res.status(403).json({ error: 'not_your_doc' });
    try {
      const result = revisions.decide(id,sid,'accept');
      noStore(res);
      res.status(result.error?409:200).json(result);
    } catch(e) { if(e instanceof RevisionError)return res.status(e.status).json(e.response);throw e }
  });

  // Server facts and history/status commit share an immediate transaction.
  app.post('/api/suggest/:id/:sid/resolve-stale', writeLimiter, (req,res) => {
    const {id,sid}=req.params;
    if(!isValidDocId(id))return res.status(400).json({error:'invalid_doc_id'});
    if(!ownsDoc(req,id))return res.status(403).json({error:'not_your_doc'});
    try { const result=revisions.decide(id,sid,'resolve-stale');noStore(res);res.json(result) }
    catch(e){if(e instanceof RevisionError)return res.status(e.status).json(e.response);throw e}
  });

  // POST /api/suggest/:id/:sid/reject -> { ok }
  app.post('/api/suggest/:id/:sid/reject', writeLimiter, (req, res) => {
    const { id, sid } = req.params;
    if (!isValidDocId(id)) return res.status(400).json({ error: 'invalid_doc_id' });
    if (!ownsDoc(req, id)) return res.status(403).json({ error: 'not_your_doc' });
    const s = getSuggestion(db, sid);
    if (!s || s.doc_id !== id) return res.status(404).json({ error: 'suggestion_not_found' });
    if (s.status !== 'open') return res.status(409).json({ error: 'already_resolved' });
    setSuggestionStatus(db, sid, 'rejected');
    noStore(res);
    res.json({ ok: true, suggestion: getSuggestion(db, sid) });
  });

  // Reopen history, never undo an accepted/rejected source rewrite.
  app.post('/api/suggest/:id/:sid/reopen', writeLimiter, (req, res) => {
    const { id, sid } = req.params;
    if (!isValidDocId(id)) return res.status(400).json({ error: 'invalid_doc_id' });
    if (!ownsDoc(req, id)) return res.status(403).json({ error: 'not_your_doc' });
    const s = getSuggestion(db, sid);
    if (!s || s.doc_id !== id) return res.status(404).json({ error: 'suggestion_not_found' });
    if (s.kind !== 'comment' || s.status !== 'rejected') return res.status(409).json({ error: 'not_resolved_comment' });
    setSuggestionStatus(db, sid, 'open');
    noStore(res);
    res.json({ ok: true, suggestion: getSuggestion(db, sid) });
  });

  // In-app feedback → GitHub issue. Its own same-origin + honeypot + per-IP
  // limiter live in feedback-api.js; the GITHUB_TOKEN stays server-side.
  app.post('/api/feedback', makeFeedbackHandler({ now: opts.now }));

  // JSON error handler. Body-parser rejects an over-limit request BEFORE our own
  // size check with a PayloadTooLargeError (413); surface it as clean JSON with
  // the file-size limit, and turn any other error into a 500 without a stack.
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.too.large' || err?.status === 413) {
      return res.status(413).json({ error: 'too_large', maxBytes: MAX_DOC_BYTES });
    }
    if (err?.status === 400 || err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'bad_request' });
    }
    return res.status(500).json({ error: 'server_error' });
  });

  return app;
}

// Copy the baked-in seed docs onto a persistent DOCS_DIR the first time we boot
// there (empty volume). Never overwrites an existing file, so real uploads and
// edited seeds are preserved across deploys.
async function seedDocs() {
  if (DOCS_DIR === SEED_DOCS_DIR) return; // running against the baked-in dir
  const { mkdir, copyFile, readdir: rd } = await import('node:fs/promises');
  await mkdir(path.join(DOCS_DIR, 'assets'), { recursive: true });
  const entries = await rd(SEED_DOCS_DIR, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isFile()) continue;
    const dest = path.join(DOCS_DIR, e.name);
    const exists = await access(dest, fsConstants.F_OK).then(() => true).catch(() => false);
    if (!exists) await copyFile(path.join(SEED_DOCS_DIR, e.name), dest);
  }
}

// Start only when run directly (not when imported by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await seedDocs();
  const db = openDb();
  createApp(db).listen(PORT, HOST, () => {
    console.log(`Marginroom on http://${HOST}:${PORT}  (open / to list + add files)`);
  });
}
