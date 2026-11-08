// Disposable-only API regression coverage. No live server or repository docs used.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { openDb, getSuggestion, listSuggestions, deleteDocData } from '../db.js';

process.env.OWNER_KEY = 'v3-disposable-owner';
process.env.SESSION_SECRET = 'v3-disposable-secret';
process.env.MMW_WRITE_PER_MIN = '10000';
process.env.MMW_READ_PER_MIN = '10000';
const dir = await mkdtemp(path.join(process.env.TMPDIR || tmpdir(), 'mmw-v3-'));
process.env.HS_DOCS_DIR = dir;
await writeFile(path.join(dir, 'fixture.html'), '<p>Disposable fixture</p>');
await writeFile(path.join(dir, 'other.html'), '<p>Other disposable fixture</p>');
const { createApp } = await import('../server.js');
const dbPath = path.join(dir, 'app.db');
let db = openDb(dbPath);
let server;
let base;
async function start() {
  server = await new Promise((resolve) => {
    const s = createApp(db).listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
}
async function stop() {
  await new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
}
function client(owner = false) {
  const jar = new Map();
  return async (method, url, body) => {
    const headers = { 'content-type': 'application/json' };
    if (owner) headers['x-owner-key'] = process.env.OWNER_KEY;
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const cookie of r.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return { status: r.status, data: await r.json() };
  };
}
const owner = client(true);
const guest = client();
const guest2 = client();
const suggest = (payload, who = guest, doc = 'fixture') => who('POST', `/api/suggest/${doc}`, payload);
const decision = (id, verb, who = owner, doc = 'fixture') => who('POST', `/api/suggest/${doc}/${id}/${verb}`, {});
const comment = (anchor) => ({ anchor, body: 'Review this', kind: 'comment' });
let acceptedId;
let rejectedId;
let staleId;

try {
  await start();
  await test('range offsets are raw UTF-16, exact repeated quote, escaped safely; retry cannot duplicate application', async () => {
    const baseText = '😀 <tag> & same same';
    const rangeStart = baseText.lastIndexOf('same');
    const payload = { anchor: 'range', quote: 'same', body: '<new>', kind: 'rewrite', baseText, rangeStart, rangeEnd: rangeStart + 4, requestId: 'range-1' };
    const r = await suggest(payload);
    assert.equal(r.status, 200);
    const s = r.data.suggestion;
    acceptedId = s.id;
    assert.equal(s.range_start, rangeStart);
    assert.deepEqual(s.replies, []);
    assert.equal(s.body, '&lt;new&gt;');
    assert.equal('request_caller' in s, false);
    assert.equal('request_payload' in s, false);
    const replay = await suggest({ ...payload });
    assert.equal(replay.status, 200);
    assert.equal(replay.data.suggestion.id, s.id);
    assert.equal(replay.data.replayed, true);
    assert.equal((await suggest({ ...payload, body: 'different' })).status, 409);
    assert.equal((await suggest({ ...payload, author: 'reviewer' })).status, 409);
    const otherCaller = await suggest(payload, guest2);
    assert.equal(otherCaller.status, 200);
    assert.notEqual(otherCaller.data.suggestion.id, s.id);
    const otherDoc = await suggest(payload, guest, 'other');
    assert.equal(otherDoc.status, 200);
    const accepted = await decision(s.id, 'accept');
    assert.equal(accepted.status, 200);
    assert.equal(accepted.data.overlay.range.text, '😀 &lt;tag&gt; &amp; same &lt;new&gt;');
    const before = (await owner('GET', '/api/versions/fixture')).data.versions.length;
    assert.equal((await decision(s.id, 'accept')).status, 409);
    assert.equal((await decision(s.id, 'reject')).status, 409);
    assert.equal((await owner('GET', '/api/versions/fixture')).data.versions.length, before);
    assert.equal((await suggest(payload)).data.suggestion.status, 'accepted');
  });

  await test('verified insertion and deletion; malformed ranges/quotes/request IDs are refused', async () => {
    const insertion = { anchor: 'insert', kind: 'rewrite', baseText: 'A😀B', quote: '', body: ' & ', rangeStart: 3, rangeEnd: 3 };
    const r = await suggest(insertion);
    assert.equal(r.status, 200);
    assert.equal((await decision(r.data.suggestion.id, 'accept')).data.overlay.insert.text, 'A😀 &amp; B');
    const deletion = await suggest({ anchor: 'delete', kind: 'rewrite', baseText: 'abcd', quote: 'bc', body: '', rangeStart: 1, rangeEnd: 3 });
    assert.equal(deletion.status, 200);
    assert.equal((await decision(deletion.data.suggestion.id, 'accept')).data.overlay.delete.text, 'ad');
    for (const patch of [
      { rangeStart: -1 }, { rangeStart: 1.2 }, { rangeEnd: 99 }, { rangeEnd: null },
      { rangeStart: 2, rangeEnd: 2 }, { rangeStart: 3, rangeEnd: 1 }, { quote: 'wrong' },
      { baseText: null }, { baseText: undefined }, { spanOcc: 0 }, { anchor: 'm:a,b' },
    ]) assert.equal((await suggest({ ...insertion, ...patch })).status, 400, JSON.stringify(patch));
    for (const requestId of ['', 'a'.repeat(129), 7, 'bad id']) {
      assert.equal((await suggest({ ...comment('bad-request'), requestId })).status, 400);
    }
    assert.equal((await suggest({ anchor: 'legacy-empty', body: 'x', kind: 'rewrite', spanOcc: 0, quote: '' })).status, 400);
    assert.equal((await suggest({ ...insertion, body: '' })).status, 400);
  });

  await test('drift makes explicit ranges and legacy Nth ranges stale without editing or snapshots', async () => {
    for (const legacy of [false, true]) {
      const anchor = legacy ? 'legacy-drift' : 'drift';
      const r = await suggest({ anchor, kind: 'rewrite', baseText: 'same same', quote: 'same', body: 'replacement', ...(legacy ? { spanOcc: 1 } : { rangeStart: 5, rangeEnd: 9 }) });
      assert.equal(r.status, 200);
      staleId = r.data.suggestion.id;
      await owner('POST', '/api/edit/fixture', { anchor, text: 'insert same same' });
      const before = (await owner('GET', '/api/versions/fixture')).data.versions.length;
      const accepted = await decision(staleId, 'accept');
      assert.equal(accepted.status, 409);
      assert.equal(accepted.data.error, 'span_stale');
      assert.equal(accepted.data.overlay[anchor].text, 'insert same same');
      assert.equal(getSuggestion(db, staleId).status, 'stale');
      assert.equal((await decision(staleId, 'accept')).status, 409);
      assert.equal((await owner('GET', '/api/versions/fixture')).data.versions.length, before);
    }
  });

  await test('real replies persist with history; permissions and document boundaries remain unchanged', async () => {
    const r = await suggest(comment('thread'));
    const id = r.data.suggestion.id;
    rejectedId = id;
    const reply = await guest('POST', `/api/suggest/fixture/${id}/replies`, { body: '<img onerror=x>', author: '<author>' });
    assert.equal(reply.status, 200);
    assert.equal(reply.data.reply.body, '&lt;img onerror=x&gt;');
    assert.equal(reply.data.reply.author, '&lt;author&gt;');
    assert.equal(reply.data.suggestion.replies.length, 1);
    assert.equal((await guest('POST', `/api/suggest/other/${id}/replies`, { body: 'wrong doc' })).status, 404);
    assert.equal((await guest('POST', '/api/suggest/fixture/missing/replies', { body: 'missing' })).status, 404);
    assert.equal((await guest('POST', `/api/suggest/fixture/${id}/replies`, { body: ' ' })).status, 400);
    assert.equal((await guest('POST', '/api/edit/fixture', { anchor: 'thread', text: 'no' })).status, 403);
    for (const verb of ['accept', 'reject']) assert.equal((await decision(id, verb, guest)).status, 403);
    assert.equal((await guest('POST', '/api/restore/fixture', { versionId: 1 })).status, 403);
    assert.equal((await decision(id, 'reject')).status, 200);
    assert.equal((await decision(id, 'reject')).status, 409);
    assert.equal((await decision(id, 'accept')).status, 409);
    assert.equal((await guest('POST', `/api/suggest/fixture/${id}/replies`, { body: 'Resolved thread follow-up' })).status, 200);
    const all = (await guest('GET', '/api/suggestions/fixture?status=all')).data.suggestions;
    assert.equal(all.length, db.prepare('SELECT COUNT(*) n FROM suggestions WHERE doc_id = ?').get('fixture').n);
    assert.equal(all.find((s) => s.id === id).replies.length, 2);
    assert.ok(all.some((s) => s.id === acceptedId && s.status === 'accepted'));
    assert.ok(all.some((s) => s.id === staleId && s.status === 'stale'));
    assert.ok((await guest('GET', '/api/suggestions/fixture')).data.suggestions.every((s) => s.status === 'open'));
    assert.equal((await guest('GET', '/api/suggestions/fixture?status=bogus')).status, 400);
    await owner('PUT', '/api/access/fixture', { level: 'view' });
    assert.equal((await guest('GET', '/api/suggestions/fixture?status=all')).status, 403);
    assert.equal((await guest('POST', `/api/suggest/fixture/${id}/replies`, { body: 'no' })).status, 403);
    assert.equal((await suggest(comment('no'))).status, 403);
    assert.equal((await owner('POST', `/api/suggest/fixture/${id}/replies`, { body: 'Owner still can reply' })).status, 200);
    assert.equal((await owner('GET', '/api/suggestions/fixture?status=all')).status, 200);
    await owner('PUT', '/api/access/fixture', { level: 'suggest' });
  });

  await test('legacy whole-block/multi-block drift and ambiguous no-base phrases cannot overwrite newer edits', async () => {
    const block = await suggest({ anchor: 'legacy-whole', quote: 'old paragraph', body: 'replacement', kind: 'rewrite' });
    await owner('POST', '/api/edit/fixture', { anchor: 'legacy-whole', text: 'human newer paragraph' });
    assert.equal((await decision(block.data.suggestion.id, 'accept')).status, 409);
    assert.equal((await owner('GET', '/api/doc/fixture')).data.overlay['legacy-whole'].text, 'human newer paragraph');
    const multi = await suggest({ anchor: 'm:multi-a,multi-b', quote: 'old a\n\nold b', baseText: 'old a\n\nold b', body: 'new a\n\nnew b', kind: 'rewrite', spanOcc: -2 });
    await owner('POST', '/api/edit/fixture', { anchor: 'multi-b', text: 'human newer b' });
    assert.equal((await decision(multi.data.suggestion.id, 'accept')).status, 409);
    assert.equal((await owner('GET', '/api/doc/fixture')).data.overlay['multi-b'].text, 'human newer b');
    const ambiguous = await suggest({ anchor: 'no-base', quote: 'OpenAI', body: 'ant', kind: 'rewrite', spanOcc: 0 });
    await owner('POST', '/api/edit/fixture', { anchor: 'no-base', text: 'OpenAI OpenAI OpenAI' });
    assert.equal((await decision(ambiguous.data.suggestion.id, 'accept')).status, 409);
    assert.equal((await owner('GET', '/api/doc/fixture')).data.overlay['no-base'].text, 'OpenAI OpenAI OpenAI');
  });

  await test('history and replies survive an actual database reopen; document deletion cascades replies', async () => {
    await stop();
    db.close();
    db = openDb(dbPath);
    await start();
    const all = (await owner('GET', '/api/suggestions/fixture?status=all')).data.suggestions;
    assert.equal(all.find((s) => s.id === rejectedId).replies.length, 3);
    assert.equal(all.find((s) => s.id === acceptedId).status, 'accepted');
    assert.equal(all.find((s) => s.id === staleId).status, 'stale');
    deleteDocData(db)('fixture');
    assert.equal(listSuggestions(db, 'fixture', 'all').length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM suggestion_replies').get().n, 0);
  });

  await test('reply request IDs retry safely and reject conflicting payloads', async () => {
    const s = await suggest(comment('reply-retry'));
    const url = `/api/suggest/fixture/${s.data.suggestion.id}/replies`;
    const payload = { body: 'safe retry', author: 'same', requestId: 'reply-once' };
    const first = await guest('POST', url, payload);
    const retry = await guest('POST', url, payload);
    assert.equal(first.status, 200);
    assert.equal(retry.status, 200);
    assert.equal(retry.data.replayed, true);
    assert.equal(retry.data.reply.id, first.data.reply.id);
    assert.equal(retry.data.suggestion.replies.length, 1);
    assert.equal((await guest('POST', url, { ...payload, body: 'changed' })).status, 409);
    assert.equal((await guest('POST', url, { ...payload, requestId: 'bad space' })).status, 400);
  });

  await test('migration upgrades populated legacy suggestions and is repeatable', () => {
    const oldPath = path.join(dir, 'old.db');
    const old = new Database(oldPath);
    old.exec(`CREATE TABLE suggestions (id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, anchor TEXT, quote TEXT, body TEXT, kind TEXT, status TEXT NOT NULL DEFAULT 'open', author TEXT, created_at TEXT NOT NULL);
      INSERT INTO suggestions VALUES ('old', 'legacy', 'a', 'q', 'b', 'comment', 'rejected', 'author', '2020');`);
    old.close();
    for (let i = 0; i < 2; i++) {
      const upgraded = openDb(oldPath);
      const row = getSuggestion(upgraded, 'old');
      assert.equal(row.status, 'rejected');
      assert.equal(row.range_start, null);
      assert.deepEqual(row.replies, []);
      assert.equal(listSuggestions(upgraded, 'legacy', 'all').length, 1);
      upgraded.close();
    }
  });
} finally {
  if (server?.listening) await stop();
  db.close();
  await rm(dir, { recursive: true, force: true });
}
