import { chromium } from 'playwright-core';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
export async function launchBrowser() {
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache/ms-playwright');
  const candidates = [process.env.CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(), '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  if (!process.env.CHROMIUM_EXECUTABLE_PATH) {
    for (const dir of (await readdir(cache).catch(() => [])).filter(n => /^chromium-\d+$/.test(n)).sort((a,b) => Number(b.split('-')[1])-Number(a.split('-')[1]))) {
      candidates.push(path.join(cache, dir, 'chrome-linux64/chrome'), path.join(cache, dir, 'chrome-linux/chrome'));
    }
  }
  for (const executablePath of process.env.CHROMIUM_EXECUTABLE_PATH ? candidates.slice(0,1) : candidates) {
    if (!executablePath) continue;
    try { await access(executablePath); } catch { continue; }
    return chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  }
  throw Error('Chromium missing. Run npm run browser:install (Linux system dependencies: npm run browser:install -- --with-deps), or set CHROMIUM_EXECUTABLE_PATH.');
}
// All resources are fulfilled from this checkout or synthetic in-memory data.
// Unexpected hosts and writes fail closed: this harness never contacts a server.
export async function isolate(context, fixture) {
  const errors = [], writes = [], requests = [];
  context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()); requests.push(url.pathname);
    if (url.origin !== 'http://frontend.test' || req.method() !== 'GET') {
      writes.push(`${req.method()} ${url.origin}${url.pathname}`);
      return route.fulfill({ status: 500, json: { error: 'Unexpected fixture request' } });
    }
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/assets') return route.fulfill({ json: { assets: [] } });
      if (url.pathname.startsWith('/api/doc/')) return route.fulfill({ json: fixture.doc });
      if (url.pathname.startsWith('/api/suggestions/')) return route.fulfill({ json: { suggestions: fixture.records } });
      errors.push(`Unexpected API ${url.pathname}`);
      return route.fulfill({ status: 404, json: {} });
    }
    const rel = url.pathname.slice(1);
    if (!/^[\w.-]+$/.test(rel)) return route.fulfill({ status: 404, body: '' });
    try {
      const body = await readFile(new URL('../../public/' + rel, import.meta.url));
      return route.fulfill({ body, contentType: rel.endsWith('.js') ? 'text/javascript' : rel.endsWith('.css') ? 'text/css' : rel.endsWith('.svg') ? 'image/svg+xml' : 'text/html' });
    } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  return { errors, writes, requests };
}
export function syntheticFixture() {
  return { doc: { id: 'synthetic', baseHtml: '<h1>Synthetic review fixture</h1>' + Array.from({ length: 18 }, (_, i) => `<h2>Chapter ${i + 1}: portable navigation</h2>` + Array.from({ length: 5 }, (_, j) => `<p>Chapter ${i + 1} paragraph ${j + 1}. Synthetic prose with 😀 same same and inline <strong>formatting</strong>. ${'Portable review text for independent scrolling. '.repeat(8)}</p>`).join('')).join(''), overlay: {}, config: {}, hasRaw: false, access: 'edit', isDocOwner: true, canEdit: true, canSuggest: true }, records: [] };
}
export async function openFixture(page) {
  await page.goto('http://frontend.test/viewer.html?doc=synthetic');
  await page.waitForFunction(() => document.querySelector('#hs-status')?.textContent.includes('已同步'));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
