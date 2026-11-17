// Standalone: bun test/security-release.test.mjs. Synthetic, loopback-only runtime.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { launchBrowser } from './helpers/browser.mjs';

const dir = await mkdtemp(path.join(process.env.TMPDIR || tmpdir(), 'security-release-'));
process.env.HS_DOCS_DIR = dir;
process.env.OWNER_KEY = 'synthetic-security-owner';
process.env.SESSION_SECRET = 'synthetic-security-secret';
process.env.MMW_UPLOAD_PER_HOUR = '1000';
const { openDb } = await import('../db.js');
const { createApp } = await import('../server.js');
const db = openDb(':memory:');
const server = await new Promise(resolve => {
  const s = createApp(db).listen(0, '127.0.0.1', () => resolve(s));
});
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let count = 0;
function check(value, message) { assert.ok(value, message); count++; }
async function post(url, body, owner = true) {
  return fetch(origin + url, { method: 'POST', headers: {
    'content-type': 'application/json', ...(owner ? { 'x-owner-key': process.env.OWNER_KEY } : {}),
  }, body: JSON.stringify(body) });
}
try {
  const original = '<p>Original text</p><script>window.syntheticActive = true</script>';
  // Preclaiming the internal raw filename must not confer ownership over a
  // future document's executable source (even when the visible ID is different).
  const alias = await post('/api/upload', { id: 'victim.raw', html: '<p>Preclaimed source alias</p>' }, false);
  check(alias.status === 400, 'reserved .raw suffix rejected (source namespace collision)');
  check((await post('/api/upload', { id: 'victim', html: original })).status === 200, 'upload original');
  check((await (await fetch(origin + '/api/raw/victim')).json()).rawHtml === original, 'original source unchanged');
  for (const id of ['../outside', '..\\outside', '.', '..', 'nested/file']) {
    check((await post('/api/upload', { id, html: '<p>x</p>' })).status === 400, `reject traversal ${id}`);
  }
  for (const name of ['../outside.svg', '..\\outside.svg', '/outside.png']) {
    check((await post('/api/upload-asset', { name, dataBase64: 'eA==' })).status === 400, `reject asset traversal ${name}`);
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>parent.syntheticSvgExecuted=true</script><text y="20">Synthetic SVG</text></svg>';
  check((await post('/api/upload-asset', { name: 'active.svg', dataBase64: Buffer.from(svg).toString('base64') })).status === 200, 'SVG accepted as image');
  const asset = await fetch(origin + '/docs/assets/active.svg');
  check(asset.headers.get('content-security-policy')?.includes('sandbox'), 'active asset navigation sandboxed');
  check(asset.headers.get('x-content-type-options') === 'nosniff', 'assets nosniff');
  const raw = await fetch(origin + '/api/raw/victim');
  check(raw.headers.get('content-type').startsWith('application/json') && raw.headers.get('content-security-policy') === 'sandbox allow-scripts', 'raw source only JSON with sandbox');
  const exported = await (await post('/api/patch-download/victim', { edits: [] })).json();
  check(exported.html === original, 'source download intentionally preserves original active content');

  // Exercise the real inline renderer even when no raw copy exists (e.g. seed or
  // historical regex-scrubbed HTML). DOMParser alone does NOT make imported nodes inert.
  const inlineHtml = '<h1>Synthetic inline fixture</h1>'
    + '<iframe srcdoc="&lt;script>parent.syntheticEscaped=true&lt;/script>"></iframe>'
    + '<a id="bad-link" href="java&#9;script:window.syntheticEscaped=true">bad link</a>'
    + '<img src="missing" onerror="window.syntheticEscaped=true">'
    + '<object data="/docs/assets/active.svg"></object>'
    + '<svg><a href="javascript:window.syntheticEscaped=true"><text>bad svg link</text></a>'
    + '<set attributeName="onload" to="window.syntheticEscaped=true"/></svg>';
  await writeFile(path.join(dir, 'inline.html'), inlineHtml);
  const nestedUpload = await post('/api/upload', { id: 'nested-upload', html: '<h1>Nested upload</h1><iframe srcdoc="&lt;script>parent.syntheticEscaped=true&lt;/script>"></iframe>' });
  check(nestedUpload.status === 200, 'encoded srcdoc document upload accepted');
  browser = await launchBrowser();
  const context = await browser.newContext();
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(origin + '/viewer.html?doc=inline');
  await page.waitForFunction(() => document.querySelector('#hs-doc-root h1'));
  const state = await page.evaluate(() => {
    const root = document.querySelector('#hs-doc-root');
    root.querySelector('#bad-link')?.click();
    return { escaped: !!window.syntheticEscaped, embeds: root.querySelectorAll('iframe,object,embed,script,svg set').length,
      handlers: [...root.querySelectorAll('*')].some(el => [...el.attributes].some(a => /^on/i.test(a.name))),
      href: root.querySelector('#bad-link')?.getAttribute('href') };
  });
  check(!state.escaped && state.embeds === 0 && !state.handlers && !state.href, 'inline renderer excludes active embeds, handlers and encoded script URLs');
  await page.goto(origin + '/viewer.html?doc=nested-upload');
  await page.waitForFunction(() => document.querySelector('#hs-doc-root h1'));
  check(await page.evaluate(() => !window.syntheticEscaped && !document.querySelector('#hs-doc-root iframe')), 'uploaded entity-encoded srcdoc cannot escape through static path');
  check(await page.evaluate(async () => {
    const img = new Image();
    img.src = '/docs/assets/active.svg';
    await img.decode();
    return img.naturalWidth > 0;
  }), 'sandbox headers preserve SVG image use');
  const svgPage = await context.newPage();
  await svgPage.goto(origin + '/docs/assets/active.svg');
  check(!(await svgPage.evaluate(() => window.syntheticSvgExecuted)), 'SVG script blocked in direct navigation');
  await page.goto(origin + '/viewer.html?doc=victim');
  await page.waitForSelector('#hs-doc-root iframe');
  check(await page.locator('#hs-doc-root iframe').getAttribute('sandbox') === 'allow-scripts', 'interactive frame never grants same-origin');
  const docFrame = page.frames().find(f => f !== page.mainFrame());
  await docFrame.waitForFunction(() => window.syntheticActive === true);
  check(await docFrame.evaluate(() => { try { return !!parent.document; } catch { return false; } }) === false, 'running document cannot read parent DOM');
  await context.close();
  console.log(`security-release: ${count} checks passed (synthetic isolated runtime)`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  db.close();
  await rm(dir, { recursive: true, force: true });
}
