import assert from 'node:assert/strict';
import { launchBrowser, isolate, syntheticFixture, openFixture } from './helpers/browser.mjs';
const browser = await launchBrowser();
const fixture = syntheticFixture();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const evidence = await isolate(context, fixture);
let cases = 0;
try {
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await openFixture(page);
  const anchors = await page.locator('#hs-doc-root p[data-hs-anchor]').evaluateAll(es => es.slice(0, 5).map(e => ({ anchor: e.dataset.hsAnchor, text: e.textContent })));
  assert.equal(anchors.length, 5);
  fixture.records = anchors.map((a, i) => ({ id: 'thread-' + i, anchor: a.anchor, base_text: a.text, quote: a.text.slice(0, 20), range_start: 0, range_end: 20, body: 'Synthetic review comment', kind: 'comment', status: i === 4 ? 'rejected' : 'open', author: 'Fixture reviewer', created_at: '2026-01-01T00:00:00Z', replies: i ? [] : Array.from({ length: 30 }, (_, j) => ({ id: 'reply-' + j, body: 'Synthetic long reply. '.repeat(20), author: 'Fixture reply' })) }));
  async function header() {
    const m = await page.evaluate(() => {
      const h = document.querySelector('.topbar').getBoundingClientRect();
      return { y: h.y, bottom: h.bottom, overflow: document.documentElement.scrollWidth - innerWidth, children: [...document.querySelector('.topbar').children].map(e => e.getBoundingClientRect().toJSON()).filter(r => r.width && r.height), width: innerWidth };
    });
    assert.equal(m.y, 0); assert.equal(m.overflow, 0);
    m.children.forEach((r, i) => { assert(r.x >= -1 && r.right <= m.width + 1); assert(r.y >= 0 && r.bottom <= m.bottom + 1); if (i) assert(m.children[i - 1].right <= r.x + 1, 'header controls must not overlap'); });
    return m;
  }
  async function toc(index, mobile) {
    if (await page.locator('.nav').isHidden()) await page.locator('#nav-toggle').click();
    await page.locator('#toc button').nth(index).click();
    await page.waitForFunction(i => {
      const h = document.querySelectorAll('#hs-doc-root :is(h1,h2,h3)')[i].getBoundingClientRect();
      return h.top >= document.querySelector('.topbar').getBoundingClientRect().bottom + 15 && h.top < innerHeight - 20;
    }, index);
    if (mobile) assert(await page.locator('.nav').isHidden());
  }
  for (const width of [1440, 1251, 1101, 1024, 768, 601]) {
    await page.setViewportSize({ width, height: 900 }); await openFixture(page); await header();
    assert.equal(await page.locator('.topbar [data-mode]:visible').count(), 3);
    assert.equal(await page.locator('.dock [data-mode]:visible').count(), 0);
    assert.equal(await page.locator('.topbar .total').textContent(), '4');
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await header();
    for (const mode of ['edit', 'suggest', 'read']) { await page.locator(`.topbar [data-mode=${mode}]`).click(); assert.equal(await page.locator(`.topbar [data-mode=${mode}]`).getAttribute('aria-pressed'), 'true'); }
    for (const id of ['name-btn', 'share-btn', 'more-btn']) { await page.locator('#' + id).click(); assert(await page.locator('#popover').isVisible()); await page.keyboard.press('Escape'); assert(await page.locator('#popover').isHidden()); }
    await page.locator('#share-btn').click(); assert.equal(await page.locator('#access-level option').count(), 3); await page.keyboard.press('Escape');
    await page.locator('[data-view=list]').click(); assert.equal(await page.locator('.annotation-row').count(), 5);
    await page.locator('[data-status=done]').click(); assert.equal(await page.locator('.annotation-row').count(), 1);
    await page.locator('[data-status=all]').click(); await page.locator('[data-type=suggestion]').click(); assert.equal(await page.locator('.annotation-row').count(), 0);
    await page.locator('[data-view=article]').click();
    for (const index of [0, 9, 18]) await toc(index, width <= 1100);
    await page.locator('#hs-docname').evaluate(e => e.textContent = 'Synthetic very long document title '.repeat(15));
    await page.locator('.person-name').evaluate(e => e.textContent = 'Long reviewer '.repeat(15)); await header();
    cases++;
  }
  // Sticky desktop navigation remains bounded; wheel input belongs to the TOC.
  for (const height of [900, 600]) {
    await page.setViewportSize({ width: 1440, height }); await openFixture(page);
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const nav = await page.locator('.nav').boundingBox(), top = await page.locator('.topbar').boundingBox();
    assert(Math.abs(nav.y - top.height) <= 1); assert(nav.y + nav.height <= height + 1);
    const box = await page.locator('#toc').boundingBox();
    const y = await page.evaluate(() => scrollY);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, 10000);
    await page.waitForFunction(() => { const e = document.querySelector('#toc'); return e.scrollTop + e.clientHeight >= e.scrollHeight - 1; });
    assert.equal(await page.evaluate(() => scrollY), y);
    await page.mouse.wheel(0, -10000); await page.waitForFunction(() => document.querySelector('#toc').scrollTop === 0);
    assert.equal(await page.evaluate(() => scrollY), y); cases++;
  }
  await page.addStyleTag({ content: '.topbar{height:96px!important}' });
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--hs-bar-h') === '96px');
  await toc(0, false); assert.equal((await page.locator('.nav').boundingBox()).y, 96); cases++;
  for (const access of ['suggest', 'view']) {
    Object.assign(fixture.doc, { access, isDocOwner: false, canEdit: false, canSuggest: access === 'suggest' });
    await openFixture(page); assert(await page.locator('.topbar [data-mode=edit]').isDisabled());
    assert.equal(await page.locator('.topbar [data-mode=suggest]').isDisabled(), access === 'view');
    await page.locator('#share-btn').click(); assert.equal(await page.locator('#access-level').count(), 0); cases++;
  }
  Object.assign(fixture.doc, { access: 'edit', isDocOwner: true, canEdit: true, canSuggest: true });
  for (const [width, height] of [[390, 844], [360, 780], [440, 956], [390, 500]]) {
    await page.setViewportSize({ width, height }); await openFixture(page); await header();
    assert.equal(await page.locator('.topbar [data-mode]:visible').count(), 0); assert.equal(await page.locator('.dock [data-mode]:visible').count(), 3);
    for (const index of [0, 9, 18]) await toc(index, true);
    await page.locator('#nav-toggle').click(); assert(await page.locator('#nav-shade').isVisible()); await page.locator('#nav-close').click(); assert(await page.locator('#nav-shade').isHidden());
    await page.locator('.comment-toggle').click(); await page.locator('[data-filter=all]').click();
    assert.equal(await page.locator('#thread-thread-0 .reply').count(), 30);
    const head = await page.locator('.discussion-head').boundingBox(), y = await page.evaluate(() => scrollY);
    await page.locator('#threads').evaluate(e => e.scrollTop = e.scrollHeight);
    assert.equal(await page.evaluate(() => scrollY), y); assert.deepEqual(await page.locator('.discussion-head').boundingBox(), head);
    const sheet = await page.locator('#discussion').boundingBox(), dock = await page.locator('.dock').boundingBox();
    assert(Math.abs(sheet.y + sheet.height - dock.y) < 1); assert(head.y >= 0 && head.y + head.height <= height);
    assert.equal(await page.locator('#discussion>.discussion-note').count(), 0);
    assert.deepEqual(await page.evaluate(() => { const c = getComputedStyle(document.body, '::after'); return [c.position, c.top, c.bottom, c.pointerEvents]; }), ['fixed', '0px', '0px', 'none']);
    await page.locator('.close-drawer').click(); assert(await page.locator('#discussion').isHidden());
    await page.locator('.comment-toggle').click(); await page.locator('[data-reply=thread-0]').click(); await page.locator('#comment-body').fill('Unsubmitted synthetic draft');
    await page.locator('#article').dispatchEvent('click'); assert(await page.locator('#discussion').isVisible()); assert.equal(await page.locator('#comment-body').inputValue(), 'Unsubmitted synthetic draft'); await page.locator('#cancel-comment').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0); cases++;
  }
  // Real editable DOM draft, cancellation and marker navigation without API writes.
  await page.setViewportSize({ width: 1440, height: 900 }); await openFixture(page);
  const marker = page.locator('[data-review-point][data-thread="thread-3"]');
  await marker.scrollIntoViewIfNeeded(); await page.evaluate(() => scrollBy(0, -120));
  const beforeMarker = await page.evaluate(() => scrollY);
  await marker.click();
  await page.waitForFunction(() => document.querySelector('#threads').scrollTop > 0);
  assert.equal(await page.evaluate(() => scrollY), beforeMarker, 'marker scroll must not move article');
  await page.locator('.close-drawer').click();
  await page.locator('.topbar [data-mode=suggest]').click();
  const editable = page.locator('#hs-doc-root p[data-hs-anchor]').nth(6);
  const original = await editable.textContent();
  await editable.click(); await page.keyboard.press('Home'); await page.keyboard.type('Synthetic draft ');
  assert(await page.locator('#draft-actions').isVisible());
  await page.locator('.topbar [data-mode=read]').click();
  assert.equal(await page.locator('.topbar [data-mode=suggest]').getAttribute('aria-pressed'), 'true', 'draft blocks mode switch');
  await page.locator('#cancel-draft').click(); assert.equal(await editable.textContent(), original);
  assert(await page.locator('#draft-actions').isHidden()); cases++;
  // Exact second repeated quote gets decorated; drift never reattaches to a name match.
  const a = anchors[0], start = a.text.lastIndexOf('same');
  fixture.records = [{ id: 'exact', anchor: a.anchor, base_text: a.text, quote: 'same', range_start: start, range_end: start + 4, body: 'replacement', kind: 'rewrite', status: 'open', author: 'Fixture', replies: [] }];
  await openFixture(page);
  assert.equal(await page.locator('[data-review-del][data-thread=exact]').textContent(), 'same');
  assert.equal(await page.locator('[data-review-ins][data-thread=exact]').textContent(), 'replacement');
  assert.equal(await page.locator('[data-review-del][data-thread=exact]').evaluate(el => { const r = document.createRange(); r.selectNodeContents(el.closest('[data-hs-anchor]')); r.setEndBefore(el); return r.toString().length; }), start);
  fixture.records[0].base_text = 'Changed ' + a.text;
  await openFixture(page); assert.equal(await page.locator('[data-review-del][data-thread=exact]').count(), 0);
  assert(await page.locator('[data-accept=exact]').isDisabled()); cases++;
  assert(!evidence.requests.includes('/api/docs'), 'removed library must never load');
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.writes, []);
  console.log(`frontend-browser: ${cases} viewport/capability/layout cases passed; no page errors, external requests or writes`);
} finally { await browser.close(); }
