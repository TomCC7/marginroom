// Structural contract for the shipped v3 shell; behavior lives in frontend.browser.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { icon, ICON_NAMES } from '../public/icons.js';
const doc = new JSDOM(readFileSync(new URL('../public/viewer.html', import.meta.url), 'utf8')).window.document;
for (const scope of ['.topbar', '.dock']) {
  const buttons = [...doc.querySelectorAll(`${scope} [data-mode]`)];
  assert.deepEqual(buttons.map(b => b.dataset.mode), ['read', 'suggest']);
  assert.ok(buttons.every(b => b.textContent.trim()), 'every mode has a label');
  assert.ok(buttons.every(b => b.tagName === 'BUTTON'));
}
for (const id of ['nav-toggle', 'nav-close', 'nav-shade', 'toc', 'nav-article', 'nav-comments', 'name-btn', 'share-btn', 'more-btn', 'hs-docname', 'hs-status', 'hs-doc-root', 'discussion', 'threads', 'annotation-list', 'toast', 'composer', 'comment-body', 'send-comment', 'cancel-comment']) {
  assert.equal(doc.querySelectorAll(`#${id}`).length, 1, `${id} is uniquely addressable`);
}
for (const id of ['popover', 'shade', 'composer', 'selection-context', 'draft-actions', 'annotation-list']) assert.equal(doc.getElementById(id).hidden, true, `${id} starts hidden`);
assert.equal(doc.getElementById('composer').getAttribute('role'), 'dialog');
assert.equal(doc.getElementById('composer').getAttribute('aria-modal'), 'true');
assert.ok(doc.querySelector('.discussion-head .close-drawer'));
assert.ok(doc.querySelector('.topbar .show-discussion .total'));
assert.ok(doc.querySelector('.dock .comment-toggle .total'));
assert.deepEqual([...doc.querySelectorAll('[data-view]')].map(b => b.dataset.view), ['article', 'list']);
assert.deepEqual([...doc.querySelectorAll('[data-status]')].map(b => b.dataset.status), ['all', 'open', 'done']);
assert.deepEqual([...doc.querySelectorAll('[data-type]')].map(b => b.dataset.type), ['all', 'comment', 'suggestion']);
assert.ok(doc.querySelector('script[type="module"][src="/review-v3.js"]'));
assert.ok(doc.querySelector('link[href="/review-v3.css"]'));
assert.equal(doc.querySelectorAll('#hs-mode-trigger,#hs-mode-menu,#hs-access,.nav-docs,#doc-links').length, 0, 'obsolete shell controls are absent');
assert.ok(ICON_NAMES.includes('link'));
assert.ok(icon('link').startsWith('<svg'));
assert.ok(icon('pencil').startsWith('<svg'));
console.log('viewer-ui: v3 shell structure passed');
