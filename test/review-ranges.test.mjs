import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { difference, locateRecord, rangeAt, textOf } from '../public/review-ranges.js';
const doc = new JSDOM('<p>A😀 <b>same</b> same &amp; tail</p>').window.document;
const p = doc.querySelector('p');
assert.equal(rangeAt(p, 9, 13).toString(), 'same');
assert.equal(rangeAt(p, 1, 3).toString(), '😀');
assert.equal(rangeAt(p, 99, 100), null);
assert.equal(rangeAt(doc.createElement('p'), 0, 0).toString(), '');
p.innerHTML = 'A<del data-review-del>old</del><ins data-review-ins>new</ins><button data-review-point>1</button>Z';
assert.equal(textOf(p), 'AnewZ');
assert.equal(textOf(p, '[data-review-ins],[data-review-point]'), 'AoldZ');
assert.equal(rangeAt(p, 1, 4).toString(), 'old');
for (const [before, after, expected] of [
  ['same same', 'same next', { start: 5, end: 9, old: 'same', next: 'next' }],
  ['A😀B', 'A😃B', { start: 1, end: 3, old: '😀', next: '😃' }],
  ['abc', 'aXbc', { start: 1, end: 1, old: '', next: 'X' }],
  ['abc', 'ac', { start: 1, end: 2, old: 'b', next: '' }],
]) assert.deepEqual(difference(before, after), expected);
const text = '😀 same same';
const s = { kind: 'comment', status: 'open', base_text: text, quote: 'same', range_start: 8, range_end: 12 };
assert.deepEqual(locateRecord(s, text), { start: 8, end: 12 });
assert.ok(locateRecord(s, 'prefix ' + text).stale);
assert.ok(locateRecord({ ...s, quote: 'wrong' }, text).stale);
assert.deepEqual(locateRecord({ base_text: text, quote: 'same', span_occ: 1 }, text), { start: 8, end: 12 });
assert.ok(locateRecord({ quote: 'same', span_occ: 0 }, text).stale, 'ambiguous legacy quote must not relocate');
assert.ok(locateRecord({ ...s, kind: 'rewrite', status: 'accepted' }, text).fallback);
assert.deepEqual(locateRecord({ quote: text, span_occ: -1 }, text), { start: 0, end: text.length });
console.log('review-ranges: UTF-16, repeated quotes, drift, insertion/deletion and DOM exclusions passed');
