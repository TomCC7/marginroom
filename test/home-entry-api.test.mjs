// Standalone isolated API contract: node test/home-entry-api.test.mjs
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = await mkdtemp(path.join(process.env.TMPDIR || tmpdir(), 'home-entry-api-'));
const docsDir = path.join(root, 'docs');
await mkdir(docsDir);
process.env.HS_DOCS_DIR = docsDir;
process.env.OWNER_KEY = randomBytes(24).toString('hex');
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
const { openDb, setDocOwner, setDocAccess, addSuggestion, addSuggestionReply, setBlockAndSnapshot } = await import('../db.js');
const { createApp } = await import('../server.js');
const { _internal } = await import('../guardrails.js');
const db = openDb(path.join(root, 'synthetic.sqlite'));
const server = await new Promise(resolve => {
  const s = createApp(db).listen(0, '127.0.0.1', () => resolve(s));
});
const origin = `http://127.0.0.1:${server.address().port}`;
const created = '2024-01-01T00:00:00.000Z';
const suggestionAt = '2024-02-01T00:00:00.000Z';
const versionAt = '2024-03-01T00:00:00.000Z';
const replyAt = '2024-04-01T00:00:00.000Z';
async function get(route, caller = 'a') {
  const headers = caller === 'admin' ? { 'x-owner-key': process.env.OWNER_KEY }
    : { cookie: `mmw_guest=${_internal.signed(`g_${caller}`)}` };
  const response = await fetch(origin + route, { headers });
  const body = await response.json();
  return { response, body };
}
async function metadata(id, caller = 'a') {
  const { response, body } = await get(`/api/doc-meta/${encodeURIComponent(id)}`, caller);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(body).sort(), ['id', 'title', 'canDelete', 'isOwned', 'isAdmin', 'pendingCount', 'activityAt'].sort());
  return body;
}
try {
  for (const [id, title] of [['a', 'A &amp; &#x1F680; &lt;img src=x onerror=alert(1)&gt;'], ['b', 'B'], ['admin', 'Admin'], ['seed', ''], ['literal', '<b>Literal</b>'], ['long', 'x'.repeat(1000)]]) {
    await writeFile(path.join(docsDir, `${id}.html`), `<!doctype html><html><head><title>${title}</title></head><body>Canonical</body></html>`);
  }
  await writeFile(path.join(docsDir, 'ghost.raw.html'), '<title>Raw alone is not a document</title>');
  await writeFile(path.join(docsDir, 'untitled.html'), '<!-- <title>Not real</title> --><script>"<title>Not real either</title>"</script><p>No title</p>');
  await utimes(path.join(docsDir, 'seed.html'), new Date('2030-01-01'), new Date('2030-01-01'));
  for (const [id, token] of [['a', 'g_a'], ['b', 'g_b'], ['admin', 'owner'], ['long', 'g_a'], ['ghost', 'g_a']]) setDocOwner(db, id, token, created);
  setDocAccess(db, 'a', 'view');
  for (const [id, status] of [['open-comment', 'open'], ['open-rewrite', 'open'], ['accepted', 'accepted'], ['rejected', 'rejected'], ['stale', 'stale']]) {
    addSuggestion(db, { id, doc_id: 'a', anchor: 'anchor', quote: '', body: 'Private', kind: id === 'open-rewrite' ? 'rewrite' : 'comment', status, author: 'Reviewer', created_at: suggestionAt });
  }
  addSuggestionReply(db, { id: 'reply', parent_id: 'accepted', author: 'Reviewer', body: 'Private reply', created_at: replyAt });
  setBlockAndSnapshot(db)('a', 'anchor', 'Edited', versionAt, 'Synthetic version');

  await test('mine discovers only real files with caller-owned rows; legacy listing unchanged', async () => {
    for (const [caller, expected] of [['a', ['a', 'long']], ['b', ['b']], ['admin', ['admin']], ['new', []]]) {
      const { response, body } = await get('/api/docs?scope=mine', caller);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(body.docs, expected);
      assert.ok(Array.isArray(body.metadata));
      assert.deepEqual(body.metadata.map(m => m.id), expected);
      assert.ok(body.metadata.every(m => m.isOwned && m.canDelete));
      for (const entry of body.metadata) assert.deepEqual(entry, await metadata(entry.id, caller));
    }
    const { body } = await get('/api/docs');
    assert.deepEqual(Object.keys(body), ['docs']);
    assert.deepEqual(body.docs, ['a', 'literal', 'long', 'seed', 'untitled']);
    const admin = (await get('/api/docs', 'admin')).body;
    assert.deepEqual(admin.docs, ['a', 'admin', 'b', 'literal', 'long', 'seed', 'untitled']);
    assert.equal((await get('/api/docs?scope=other')).body.metadata, undefined);
  });

  await test('exact metadata uses canonical title as bounded literal text and real activity', async () => {
    assert.deepEqual(await metadata('a'), { id: 'a', title: 'A & 🚀 <img src=x onerror=alert(1)>', canDelete: true, isOwned: true, isAdmin: false, pendingCount: 2, activityAt: replyAt });
    assert.equal((await metadata('literal')).title, '<b>Literal</b>');
    await writeFile(path.join(docsDir, 'literal.html'), '<title>&#x110000; <script>literal()</script> <!-- literal --> &amp;lt;</title>');
    assert.equal((await metadata('literal')).title, '� <script>literal()</script> <!-- literal --> &lt;', 'title raw-text markup stays literal, entities decode once');
    assert.equal((await metadata('long')).title.length, 300);
    const seed = await metadata('seed');
    assert.equal(seed.title, 'seed');
    assert.equal(seed.activityAt, null, 'filesystem mtime is not document activity');
    assert.equal(seed.isOwned, false);
    assert.equal(seed.canDelete, false);
    assert.equal(seed.pendingCount, 0);
    assert.equal((await metadata('untitled')).title, 'untitled');
    await writeFile(path.join(docsDir, 'literal.html'), '<title>Terms &copy; Studio &mdash; Draft</title>');
    assert.equal((await metadata('literal')).title, 'Terms © Studio — Draft');
    await writeFile(path.join(docsDir, 'literal.html'), '<textarea><title>Decoy</title></textarea><title>Actual document</title>');
    assert.equal((await metadata('literal')).title, 'Actual document');
    await writeFile(path.join(docsDir, 'literal.html'), '<div>'.repeat(15000) + 'Nested synthetic metadata' + '</div>'.repeat(15000));
    assert.equal((await metadata('literal')).title, 'literal', 'deep titleless source cannot exhaust metadata traversal stack');
    assert.equal((await metadata('b')).activityAt, created);
  });

  await test('admin authority is distinct from ownership, whoami stays compatible', async () => {
    for (const id of ['a', 'b', 'seed']) {
      const m = await metadata(id, 'admin');
      assert.equal(m.isAdmin, true);
      assert.equal(m.isOwned, false);
      assert.equal(m.canDelete, true);
    }
    assert.equal((await metadata('admin', 'admin')).isOwned, true);
    assert.equal((await get('/api/whoami', 'admin')).body.isOwner, true);
    assert.equal((await get('/api/whoami', 'a')).body.isOwner, false);
  });

  await test('view-only link allows reading but hides counts and private discussion activity', async () => {
    assert.equal((await get('/api/doc/a', 'b')).response.status, 200);
    assert.equal((await get('/api/suggestions/a', 'b')).response.status, 403);
    assert.deepEqual(await metadata('a', 'b'), { id: 'a', title: 'A & 🚀 <img src=x onerror=alert(1)>', canDelete: false, isOwned: false, isAdmin: false, pendingCount: null, activityAt: versionAt });
    for (const level of ['suggest', 'edit']) {
      setDocAccess(db, 'a', level);
      assert.equal((await get('/api/suggestions/a', 'b')).response.status, 200);
      assert.equal((await metadata('a', 'b')).pendingCount, 2);
      assert.equal((await metadata('a', 'b')).activityAt, replyAt);
      assert.equal((await metadata('a', 'b')).canDelete, false, 'edit access never grants deletion');
      assert.deepEqual((await get('/api/docs?scope=mine', 'b')).body.docs, ['b'], 'exact-link reading never adds a document to mine');
    }
    setDocAccess(db, 'a', 'view');
    assert.equal((await metadata('a', 'admin')).pendingCount, 2);
    db.prepare('DELETE FROM suggestion_replies').run();
    assert.equal((await metadata('a')).activityAt, versionAt);
    db.prepare('DELETE FROM document_versions').run();
    db.prepare('DELETE FROM documents').run();
    assert.equal((await metadata('a')).activityAt, suggestionAt);
  });

  await test('uploaded metadata preserves original literal title without changing scrubbed document or replacement behavior', async () => {
    const id = 'uploaded-title';
    const caller = 'title-upload';
    const title = '<img src=x onerror=window.TITLE_RAN=true> & Synthetic';
    const html = '<!doctype html><html><head><!-- <title>Comment decoy</title> -->'
      + '<script>"<title>Script decoy</title>"</script>'
      + '<title>&lt;img src=x onerror=window.TITLE_RAN=true&gt; &amp; Synthetic</title>'
      + '</head><body><input value="Private form value"><script>window.TITLE_RAN=true</script></body></html>';
    async function upload(source, overwrite = false) {
      const response = await fetch(origin + '/api/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `mmw_guest=${_internal.signed(`g_${caller}`)}` },
        body: JSON.stringify({ id, html: source, overwrite }),
      });
      assert.equal(response.status, 200);
      return response.json();
    }
    assert.equal((await upload(html)).interactive, true);
    const exact = await metadata(id, caller);
    assert.equal(exact.title, title);
    const mine = await get('/api/docs?scope=mine', caller);
    assert.deepEqual(mine.body.docs, [id]);
    assert.deepEqual(mine.body.metadata, [exact]);
    assert.equal(JSON.stringify(exact).includes('Private form value'), false);
    const doc = (await get(`/api/doc/${id}`, caller)).body;
    assert.equal(doc.hasRaw, true);
    assert.equal(doc.baseHtml.includes('onerror='), false, 'metadata does not restore active-looking text to scrubbed source');
    assert.equal(doc.baseHtml.includes('<script>'), false);
    assert.equal((await metadata(id, 'b')).title, title, 'exact-link readers get the same literal title');

    assert.equal((await upload('<title>Replacement &amp; static</title><p>Static</p>', true)).interactive, false);
    const replacement = await metadata(id, caller);
    assert.equal(replacement.title, 'Replacement & static', 'static overwrite does not retain stale original title');
    assert.deepEqual((await get('/api/docs?scope=mine', caller)).body.metadata, [replacement]);
    assert.equal((await get(`/api/doc/${id}`, caller)).body.hasRaw, false);
  });

  await test('missing, malformed, internal and oversized ids match bounded doc reading', async () => {
    for (const [id, status] of [['missing', 404], ['ghost', 404], ['a.raw', 400], ['..\\escape', 400], ['nested/file', 400], ['x'.repeat(129), 400]]) {
      const meta = await get(`/api/doc-meta/${encodeURIComponent(id)}`);
      const doc = await get(`/api/doc/${encodeURIComponent(id)}`);
      assert.equal(meta.response.status, status, id);
      assert.deepEqual(meta.body, doc.body);
    }
  });
} finally {
  await new Promise(resolve => server.close(resolve));
  db.close();
  await rm(root, { recursive: true, force: true });
}
