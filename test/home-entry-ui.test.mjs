import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launchBrowser } from './helpers/browser.mjs';
import { fileURLToPath } from 'node:url';

// Explicit isolated API fixtures: no production service, credentials, or writes.
const root = fileURLToPath(new URL('../public/', import.meta.url));
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
test('shared history: bounded, case-sensitive canonical IDs, state, and storage fallback', async () => {
  globalThis.localStorage = storage(); globalThis.sessionStorage = storage();
  const history = await import('../public/entry-history.js?unit');
  for (let i = 0; i < 110; i++) history.rememberDoc({ id: `doc-${i}`, title: `Title ${i}` });
  assert.equal(history.readHistory().length, 100);
  history.rememberDoc({ id: 'doc-109', title: '<script>inert</script>' });
  assert.equal(history.readHistory().length, 100);
  assert.equal(history.readHistory()[0].title, '<script>inert</script>');
  history.rememberDoc({ id: 'DOC-109', title: 'Different canonical ID' });
  assert.equal(history.readHistory()[0].id, 'DOC-109');
  assert.equal(history.readHistory()[1].id, 'doc-109');
  for (const id of ['.', '..', 'a.raw', 'a'.repeat(129), 'a/b']) history.rememberDoc({ id });
  assert.equal(history.readHistory()[0].id, 'DOC-109');
  history.rememberDoc({ id: 'a..b' }); assert.equal(history.readHistory()[0].id, 'a..b');
  history.removeRecent('DOC-109'); assert.ok(!history.readHistory().some(item => item.id === 'DOC-109'));
  history.saveHomeState({ view: 'mine', query: '海', scrollY: 825 });
  assert.deepEqual(history.loadHomeState(), { view: 'mine', query: '海', scrollY: 825 });
  globalThis.localStorage.setItem = () => { throw new Error('quota'); };
  history.clearRecent(); assert.deepEqual(history.readHistory(), []);
  history.rememberDoc({ id: 'offline', title: 'Still usable' }); assert.equal(history.readHistory()[0].id, 'offline');
  delete globalThis.localStorage; delete globalThis.sessionStorage;
});

test('real browser homepage and import interactions against isolated API fixtures', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const runtimeErrors = [], calls = [], uploads = [], assetUploads = [];
    let admin = false, uploadFailure = false, metadataMissing = false, assetFailure = false;
    const savedAssets = new Map();
    let raceBytes = null, assetReadFailure = false;
    const entries = [
      { id: 'owned', title: '海边观测站网页', canDelete: true, isOwned: true, isAdmin: false, pendingCount: 3, activityAt: '2026-11-08T00:00:00Z' },
      { id: 'shared', title: '<img src=x onerror=window.TITLE_RAN=true> 长标题', canDelete: false, isOwned: false, isAdmin: false, pendingCount: 2, activityAt: null },
    ];
    page.on('pageerror', error => runtimeErrors.push(error.message));
    await page.addInitScript(() => {
      // This existing workflow suite deliberately exercises Simplified Chinese.
      // English/default/persistence are covered by i18n-home.browser.mjs.
      localStorage.setItem('marginroom.locale.v1','zh-CN');
      if (!localStorage.getItem('marginroom.recent.v1')) localStorage.setItem('marginroom.recent.v1', JSON.stringify({ version: 1, entries: [
        { id: 'owned', title: 'Old title', openedAt: '2026-11-08T00:00:00Z' },
        { id: 'shared', title: 'Shared title', openedAt: '2026-11-07T00:00:00Z' },
      ] }));
    });
    await page.route('http://entry.test/**', async route => {
      const url = new URL(route.request().url()); calls.push(url.pathname + url.search);
      const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (url.pathname === '/api/whoami') return json({ isOwner: admin, docLimit: 2 });
      if (url.pathname === '/api/docs') return json({ docs: ['owned'], metadata: [{ ...entries[0], isAdmin: admin }] });
      if (url.pathname.startsWith('/api/doc-meta/')) {
        const id = decodeURIComponent(url.pathname.split('/').at(-1));
        const item = entries.find(item => item.id === id);
        return item && !metadataMissing ? json(item) : json({ error: 'doc_not_found' }, 404);
      }
      if (url.pathname === '/api/upload') {
        const payload = route.request().postDataJSON(); uploads.push(payload);
        if (uploadFailure) return route.abort('failed');
        if (!payload.overwrite && ['clash', 'clash-2'].includes(payload.id)) return json({ error: 'doc_exists' }, 409);
        return json({ ok: true, id: payload.id });
      }
      if (url.pathname === '/api/assets') return json({ assets: [...savedAssets.keys()] });
      if (url.pathname.startsWith('/docs/assets/')) {
        if (assetReadFailure) return route.fulfill({ status: 503, body: 'Unavailable' });
        const bytes = savedAssets.get(decodeURIComponent(url.pathname.split('/').at(-1)));
        return route.fulfill({ status: bytes ? 200 : 404, contentType: 'image/svg+xml', body: bytes || '' });
      }
      if (url.pathname === '/api/upload-asset') {
        const payload = route.request().postDataJSON(); assetUploads.push(payload);
        if (assetFailure) return json({ error: 'write_failed' }, 500);
        if (raceBytes) savedAssets.set(payload.name, raceBytes);
        const existed = savedAssets.has(payload.name);
        if (!existed) savedAssets.set(payload.name, Buffer.from(payload.dataBase64, 'base64'));
        return json({ ok: true, name: payload.name, existed });
      }
      if (url.pathname.startsWith('/api/doc/') && route.request().method() === 'DELETE') {
        const index = entries.findIndex(item => item.id === decodeURIComponent(url.pathname.split('/').at(-1)));
        if (index >= 0) entries.splice(index, 1);
        return json({ ok: true });
      }
      if (url.pathname === '/viewer.html') return route.fulfill({ contentType: 'text/html', body: '<title>Isolated viewer destination</title>' });
      if (url.pathname === '/feedback.js') return route.fulfill({ contentType: 'text/javascript', body: '' });
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      return route.fulfill({ contentType: name.endsWith('.html') ? 'text/html' : 'text/javascript', body: await readFile(root + name, 'utf8') });
    });
    await page.goto('http://entry.test/?key=private-test-key');
    await page.waitForSelector('.row');
    assert.equal(new URL(page.url()).search, '');
    assert.equal(await page.locator('.row').count(), 2);
    assert.equal(calls.filter(url => url.startsWith('/api/docs')).length, 0);
    assert.equal(await page.locator('.title').nth(1).textContent(), entries[1].title);
    assert.equal(await page.evaluate(() => window.TITLE_RAN), undefined);
    for (const width of [1440, 1024, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.click('#import');
      assert.ok(await page.locator('#doImport').isVisible());
      assert.ok(await page.evaluate(() => document.querySelector('.modalfoot').getBoundingClientRect().bottom <= innerHeight));
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press('Tab');
        assert.ok(await page.evaluate(() => document.querySelector('dialog').contains(document.activeElement)));
      }
      await page.keyboard.press('Escape');
      assert.ok(await page.locator('#import').evaluate(node => node === document.activeElement));
    }
    await page.locator('.more').nth(1).click();
    assert.equal(await page.getByRole('button', { name: '删除文稿…', exact: true }).count(), 0);
    await page.getByRole('button', { name: '分享文稿链接', exact: true }).click();
    assert.equal(await page.inputValue('.sharelink'), 'http://entry.test/viewer.html?doc=shared');
    await page.keyboard.press('Escape');
    assert.ok(await page.locator('.more').nth(1).evaluate(node => node === document.activeElement));
    await page.click('#mine'); await page.waitForFunction(() => document.querySelectorAll('.row').length === 1);
    assert.ok(calls.some(url => url.startsWith('/api/docs?scope=mine')));
    admin = true; await page.click('#recent'); await page.click('#mine');
    await page.waitForFunction(() => document.querySelector('#context').textContent.includes('管理员身份创建'));
    assert.equal(await page.textContent('#mine'), '我的文稿');
    assert.equal(await page.locator('.row').count(), 1);
    await page.click('#recent'); await page.waitForFunction(() => document.querySelectorAll('.row').length === 2);
    metadataMissing = true; await page.reload(); await page.waitForSelector('.row');
    assert.equal(await page.locator('.pending').count(), 0);
    await page.locator('.more').first().click();
    assert.equal(await page.getByRole('button', { name: '删除文稿…', exact: true }).count(), 0);
    await page.keyboard.press('Escape'); metadataMissing = false;
    await page.click('#import'); await page.click('#doImport');
    assert.match(await page.textContent('#importError'), /请选择/);
    await page.click('.paste summary');
    const source = '<!doctype html><html><head><title>Imported title</title></head><body><script>window.SOURCE_RAN=true</script><p>Document</p></body></html>';
    await page.fill('#source', source); await page.fill('#paste-id', 'clash');
    await page.click('#doImport'); await page.waitForSelector('#duplicate:not([hidden])');
    assert.match(await page.textContent('.warn'), /覆盖原文稿源码.*保留评审历史.*可能不再匹配.*建议.*保留两份/);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.inputValue('#source'), source);
    await page.click('.modalfoot .primary');
    await page.getByRole('button', { name: '保留两份', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#duplicateText').textContent.includes('clash-2'));
    await page.getByRole('button', { name: '保留两份', exact: true }).click();
    await page.waitForURL('**/viewer.html?doc=clash-3');
    assert.deepEqual(uploads.map(item => [item.id, item.overwrite]), [['clash', false], ['clash-2', false], ['clash-3', false]]);
    await page.goto('http://entry.test/'); await page.waitForSelector('.row');
    await page.click('#import');
    await page.locator('#htmlFile').setInputFiles({ name: 'new-file.html', mimeType: 'text/html', buffer: Buffer.from(source) });
    uploadFailure = true; await page.click('#doImport');
    await page.waitForFunction(() => document.querySelector('#importError').textContent.length > 0);
    assert.equal(await page.locator('#htmlFile').evaluate(node => node.files[0].name), 'new-file.html');
    assert.equal(await page.evaluate(() => window.SOURCE_RAN), undefined);
    uploadFailure = false; await page.keyboard.press('Escape'); await page.click('#import');
    await page.click('.paste summary'); await page.fill('#source', source); await page.fill('#paste-id', 'clash');
    await page.click('#doImport'); await page.waitForSelector('#duplicate:not([hidden])');
    await page.getByRole('button', { name: '替换', exact: true }).click();
    await page.waitForURL('**/viewer.html?doc=clash');
    assert.equal(uploads.at(-1).overwrite, true);
    await page.goto('http://entry.test/'); await page.waitForSelector('.row'); await page.click('#import');
    await page.locator('#htmlFile').setInputFiles({ name: 'large.html', mimeType: 'text/html', buffer: Buffer.alloc(2_000_001, 65) });
    const beforeTooLarge = uploads.length;
    await page.click('#doImport'); assert.match(await page.textContent('#importError'), /超过 2 MB/);
    assert.equal(uploads.length, beforeTooLarge);
    await page.keyboard.press('Escape'); await page.click('#import');
    const imageSource = source.replace('</body>', '<img src="img/photo.svg"></body>');
    await page.locator('#htmlFile').setInputFiles({ name: 'with-images.html', mimeType: 'text/html', buffer: Buffer.from(imageSource) });
    await page.locator('#images').setInputFiles({ name: 'PHOTO.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
    const beforeImageImport = uploads.length;
    assetFailure = true; await page.click('#doImport');
    await page.waitForFunction(() => document.querySelector('#importError').textContent.length > 0);
    assert.equal(uploads.length, beforeImageImport);
    assert.equal(await page.locator('#images').evaluate(node => node.files[0].name), 'PHOTO.svg');
    assetFailure = false; await page.click('#doImport');
    await page.waitForURL('**/viewer.html?doc=with-images');
    assert.equal(assetUploads.at(-1).name, 'photo.svg');
    assert.ok(assetUploads.at(-1).dataBase64);
    assert.equal(uploads.length, beforeImageImport + 1);
    // The fixture viewer does not load a source: homepage must not remember it.
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('marginroom.recent.v1')).entries.map(item => item.id)), ['owned', 'shared']);

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>');
    const otherSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1"/></svg>');
    async function imageImport(id, name, bytes, paste = false) {
      await page.goto('http://entry.test/'); await page.waitForSelector('.row'); await page.click('#import');
      const html = source.replace('</body>', `<img src="img/${name}"></body>`);
      if (paste) {
        await page.click('.paste summary'); await page.fill('#source', html); await page.fill('#paste-id', id);
      } else await page.locator('#htmlFile').setInputFiles({ name: `${id}.html`, mimeType: 'text/html', buffer: Buffer.from(html) });
      await page.locator('#images').setInputFiles({ name, mimeType: 'image/svg+xml', buffer: bytes });
      await page.click('#doImport');
      return html;
    }
    savedAssets.set('same.svg', svg);
    const beforeSame = assetUploads.length;
    await imageImport('identical', 'same.svg', svg);
    await page.waitForURL('**/viewer.html?doc=identical');
    assert.equal(assetUploads.length, beforeSame);
    assert.ok(calls.includes('/docs/assets/same.svg'));
    assetReadFailure = true;
    const beforeReadFailure = uploads.length;
    await imageImport('unverifiable', 'same.svg', svg);
    await page.waitForFunction(() => document.querySelector('#importError').textContent.includes('无法核实图片'));
    assert.equal(uploads.length, beforeReadFailure);
    assert.equal(new URL(page.url()).pathname, '/');
    assetReadFailure = false;
    for (const paste of [false, true]) {
      const before = uploads.length, assetBefore = assetUploads.length;
      const html = await imageImport('collision', 'same.svg', otherSvg, paste);
      await page.waitForFunction(() => document.querySelector('#importError').textContent.includes('内容不同'));
      assert.match(await page.textContent('#importError'), /重命名图片.*修改 HTML/);
      assert.equal(new URL(page.url()).pathname, '/');
      assert.equal(uploads.length, before);
      assert.equal(assetUploads.length, assetBefore);
      assert.deepEqual(savedAssets.get('same.svg'), svg);
      assert.equal(await page.locator('#images').evaluate(node => node.files[0].name), 'same.svg');
      if (paste) assert.equal(await page.inputValue('#source'), html);
      else assert.equal(await page.locator('#htmlFile').evaluate(node => node.files[0].name), 'collision.html');
    }
    // Different-case stored basenames must not suppress a missing exact name.
    savedAssets.set('CASE.svg', otherSvg);
    const beforeCase = assetUploads.length;
    await imageImport('case-sensitive', 'case.svg', svg);
    await page.waitForURL('**/viewer.html?doc=case-sensitive');
    assert.equal(assetUploads.length, beforeCase + 1);
    assert.equal(assetUploads.at(-1).name, 'case.svg');
    assert.deepEqual(savedAssets.get('case.svg'), svg);
    assert.deepEqual(savedAssets.get('CASE.svg'), otherSvg);
    // Server returns success/existed after another writer wins the asset name.
    raceBytes = otherSvg;
    const beforeRace = uploads.length;
    await imageImport('race', 'race.svg', svg);
    await page.waitForFunction(() => document.querySelector('#importError').textContent.includes('内容不同'));
    assert.equal(uploads.length, beforeRace);
    assert.equal(new URL(page.url()).pathname, '/');
    assert.ok(calls.includes('/docs/assets/race.svg'));
    raceBytes = null;
    // Optional later image selection keeps saved HTML intact across retries.
    await page.goto('http://entry.test/'); await page.waitForSelector('.row'); await page.click('#import');
    await page.locator('#htmlFile').setInputFiles({ name: 'later-images.html', mimeType: 'text/html', buffer: Buffer.from(source.replace('</body>', '<img src="later.svg"></body>')) });
    const beforeLater = uploads.length;
    await page.click('#doImport'); await page.waitForSelector('#missingImages');
    assert.equal(uploads.length, beforeLater + 1);
    await page.locator('#missingImages').setInputFiles({ name: 'later.svg', mimeType: 'image/svg+xml', buffer: svg });
    assetFailure = true;
    await page.getByRole('button', { name: '上传图片并打开', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#assetError').textContent.length > 0);
    assert.equal(uploads.length, beforeLater + 1);
    assetFailure = false;
    await page.getByRole('button', { name: '上传图片并打开', exact: true }).click();
    await page.waitForURL('**/viewer.html?doc=later-images');
    assert.equal(uploads.length, beforeLater + 1);
    await page.goto('http://entry.test/'); await page.waitForSelector('.row');
    await page.click('#clear'); await page.locator('dialog').getByRole('button', { name: '清空记录', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.row').length === 0);
    assert.equal(calls.filter(url => url.startsWith('/api/doc/')).length, 0);
    await page.reload(); await page.waitForFunction(() => document.querySelector('#rows').textContent.includes('还没有打开记录'));
    await page.click('#mine'); await page.waitForSelector('.row');
    await page.locator('.more').first().click(); await page.getByRole('button', { name: '删除文稿…', exact: true }).click();
    await page.getByRole('button', { name: '删除文稿', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('dialog').open);
    assert.ok(!entries.some(item => item.id === 'owned'));
    assert.deepEqual(runtimeErrors, []);
  } finally { await browser.close(); }
});
