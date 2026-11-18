// Real Bun child, on-disk SQLite, loopback-only ephemeral listener.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';

const root = await mkdtemp(join(tmpdir(), 'marginroom-maintenance-'));
const flag = join(root, 'maintenance.flag');
const docs = join(root, 'docs');
const owner = randomBytes(24).toString('hex');
const sockets = new Set();
let child, exited, log;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 5000) {
  const end = performance.now() + timeout;
  do { const result = await check(); if (result) return result; await pause(20); } while (performance.now() < end);
  throw new Error(`Condition timed out; server log:\n${log}`);
}
async function start(timeout) {
  log = '';
  child = spawn(process.execPath, [new URL('../server.js', import.meta.url).pathname], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', NODE_ENV: 'development',
      HS_DB_PATH: join(root, 'fixture.db'), HS_DOCS_DIR: docs,
      MMW_MAINTENANCE_FILE: flag, MMW_SHUTDOWN_TIMEOUT_MS: String(timeout),
      OWNER_KEY: owner, SESSION_SECRET: randomBytes(24).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  exited = once(child, 'close');
  for (const stream of [child.stdout, child.stderr]) stream.setEncoding('utf8').on('data', chunk => { log += chunk; });
  const [, port] = await until(() => /http:\/\/127\.0\.0\.1:(\d+)/.exec(log));
  return `http://127.0.0.1:${port}`;
}
function request(origin, path, options) {
  return fetch(origin + path, { signal: AbortSignal.timeout(1500), ...options });
}
async function status(origin) {
  const response = await request(origin, '/api/maintenance/status');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
}
async function slowUpload(origin, id) {
  const { port, host } = new URL(origin);
  const socket = net.createConnection({ host: '127.0.0.1', port: Number(port) });
  sockets.add(socket);
  let response = '';
  socket.setEncoding('utf8').on('data', chunk => { response += chunk; });
  socket.on('error', () => {});
  const closed = new Promise(resolve => socket.once('close', () => { sockets.delete(socket); resolve(response); }));
  await once(socket, 'connect');
  const body = JSON.stringify({ id, html: '<html><body><p>Drain fixture</p></body></html>' });
  socket.write(`POST /api/upload HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\nX-Owner-Key: ${owner}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body.slice(0, 4)}`);
  await until(async () => (await status(origin)).inflight === 1);
  return { finish: () => socket.write(body.slice(4)), closed };
}

async function browserChecks(origin) {
  const id = 'recovered', text = 'Drain fixture';
  const anchor = createHash('sha256').update(text).digest('hex');
  const comment = await request(origin, `/api/suggest/${id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anchor, quote: text, baseText: text, body: 'A fixture comment', kind: 'comment' }),
  });
  assert.equal(comment.status, 200);
  const { suggestion } = await comment.json();
  const { launchBrowser } = await import('./helpers/browser.mjs');
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/viewer.html?doc=${id}`);
    await page.locator(`[data-reply="${suggestion.id}"]`).click();
    const field = page.locator('#comment-body');
    const draft = 'Keep this unsent reply';
    await field.fill(draft);
    await writeFile(flag, '');
    const send = page.locator('#send-comment');
    const rejected = page.waitForResponse(r => r.url().endsWith('/replies') && r.status() === 503);
    await send.click();
    await rejected;
    await page.waitForFunction(() => /维护中|under maintenance/i.test(document.querySelector('#hs-status').textContent));
    assert.equal(await field.inputValue(), draft);
    assert.ok(await send.isEnabled());
    await rm(flag);
    await send.click();
    await page.locator('#composer').waitFor({ state: 'hidden' });
    const rows = await (await request(origin, `/api/suggestions/${id}`)).json();
    assert.ok(rows.suggestions[0].replies.some(reply => reply.body === draft));

    await page.goto(origin);
    await page.locator('#import').click();
    const file = page.locator('#htmlFile');
    await file.setInputFiles({ name: 'maintenance-browser.html', mimeType: 'text/html', buffer: Buffer.from('<title>Maintenance fixture</title><p>Browser import</p>') });
    await writeFile(flag, '');
    await page.locator('#doImport').click();
    await page.getByText(/维护中|under maintenance/i).waitFor();
    assert.equal(await file.evaluate(el => el.files[0]?.name), 'maintenance-browser.html');
    await rm(flag);
    await page.locator('#doImport').click();
    await page.waitForURL('**/viewer.html?doc=*');
    assert.deepEqual(errors, []);
    console.log('PASS Chromium shows maintenance notices, keeps the reply and selected import file, and retries both after flag removal');
  } finally {
    await browser.close();
  }
}

try {
  const origin = await start(5000);
  assert.deepEqual(await status(origin), { maintenance: false, inflight: 0 });
  const accepted = await slowUpload(origin, 'accepted-before-flag');
  await writeFile(flag, '');
  assert.deepEqual(await status(origin), { maintenance: true, inflight: 1 });

  // Keep the HTTP probes synchronized with every actual non-safe route.
  const routes = [...(await readFile(new URL('../server.js', import.meta.url), 'utf8'))
    .matchAll(/\bapp\.(post|put|patch|delete)\('([^']+)'/g)]
    .map(([, method, path]) => [method.toUpperCase(), path.replace(/:\w+/g, 'fixture')]);
  assert.ok(routes.length >= 22);
  for (const [method, path] of [...routes, ['PATCH', '/api/not-a-route']]) {
    const response = await request(origin, path, { method, headers: { 'Content-Type': 'application/json' }, body: '{malformed' });
    assert.equal(response.status, 503, `${method} ${path}`);
    assert.match(response.headers.get('retry-after'), /^\d+$/);
    assert.equal((await response.json()).error, 'maintenance');
  }
  for (const method of ['GET', 'HEAD']) {
    for (const path of ['/', '/api/docs', '/api/instance']) {
      const response = await request(origin, path, { method });
      assert.equal(response.status, 200, `${method} ${path}`);
      await response.arrayBuffer();
    }
  }
  console.log(`PASS maintenance gates all ${routes.length} registered non-safe routes plus unregistered PATCH; GET/HEAD work; probe excludes itself`);
  accepted.finish();
  assert.match(await accepted.closed, /^HTTP\/1\.1 200 /);
  await until(async () => (await status(origin)).inflight === 0);
  assert.match(await readFile(join(docs, 'accepted-before-flag.html'), 'utf8'), /Drain fixture/);
  console.log('PASS accepted slow upload completes and persists after flag is enabled');
  await rm(flag);
  assert.deepEqual(await status(origin), { maintenance: false, inflight: 0 });
  const recovered = await slowUpload(origin, 'recovered');
  recovered.finish();
  assert.match(await recovered.closed, /^HTTP\/1\.1 200 /);
  console.log('PASS removing the flag restores writes without a restart');
  if (process.argv.includes('--browser')) await browserChecks(origin);

  const draining = await slowUpload(origin, 'accepted-before-term');
  child.kill('SIGTERM');
  await until(() => log.includes('draining HTTP requests'));
  await until(async () => { try { await request(origin, '/'); return false; } catch { return true; } });
  assert.equal(child.exitCode, null, 'must not exit while admitted body is incomplete');
  draining.finish();
  assert.match(await draining.closed, /^HTTP\/1\.1 200 /);
  assert.deepEqual(await exited, [0, null]);
  assert.match(log, /HTTP drain complete; database closed/);
  assert.match(await readFile(join(docs, 'accepted-before-term.html'), 'utf8'), /Drain fixture/);
  console.log('PASS SIGTERM stops new connections, waits for upload, closes SQLite and exits 0');

  const limited = await start(250);
  const stalled = await slowUpload(limited, 'unfinished');
  child.kill('SIGTERM');
  assert.deepEqual(await exited, [0, null]);
  assert.equal(await stalled.closed, '');
  assert.match(log, /timed out after 250 ms; forcing exit/);
  await assert.rejects(readFile(join(docs, 'unfinished.html')), { code: 'ENOENT' });
  console.log('PASS configured 250 ms drain timeout forces exit 0 and disconnects incomplete upload');

  await start(5000);
  child.kill('SIGINT');
  assert.deepEqual(await exited, [0, null]);
  assert.match(log, /SIGINT.*draining/);
  console.log('PASS SIGINT also drains and exits 0');
} finally {
  for (const socket of sockets) socket.destroy();
  if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await exited?.catch(() => {});
  await rm(root, { recursive: true, force: true });
}
