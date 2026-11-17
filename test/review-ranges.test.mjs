import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { difference, locateRecord, rangeAt, textOf, singleBlockRange } from '../public/review-ranges.js';
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
const boundaryDoc=new JSDOM('<ul><li data-hs-anchor="a">A😀 <em>same</em> same</li><li data-hs-anchor="b">next</li><li data-hs-anchor="empty"></li></ul><li><p data-hs-anchor="c">one</p><p data-hs-anchor="d">two</p></li>').window.document;
const [a,b,empty,c,d]=['a','b','empty','c','d'].map(k=>boundaryDoc.querySelector(`[data-hs-anchor="${k}"]`));
for(const [end,offset,allowed] of [[b,0,true],[b.firstChild,0,true],[b.firstChild,1,false],[empty,0,false]]){
 const r=boundaryDoc.createRange();r.setStart(a.firstChild,0);r.setEnd(end,offset);const result=singleBlockRange(r);assert.equal(!!result,allowed);if(result){assert.equal(result.el,a);assert.equal(result.range.toString(),a.textContent)}
}
for(const offset of [0,a.childNodes.length]){const r=boundaryDoc.createRange();r.setStart(a,offset);r.collapse(true);assert(singleBlockRange(r,a)?.range.collapsed)}
const emptyRange=boundaryDoc.createRange();emptyRange.selectNodeContents(empty);assert(singleBlockRange(emptyRange,empty)?.range.collapsed);
const nestedRange=boundaryDoc.createRange();nestedRange.setStart(c.firstChild,0);nestedRange.setEnd(d.firstChild,1);assert.equal(singleBlockRange(nestedRange),null);nestedRange.setEnd(d,0);assert.equal(singleBlockRange(nestedRange).range.toString(),'one');
console.log('singleBlockRange: native next-block offset0 only, true sibling/nested text refusal, empty/collapsed and element end offsets passed');
const formatted=new JSDOM('<ul><li data-hs-anchor="a">one</li>\n  <li data-hs-anchor="b">two</li>\n <li></li>\n<li data-hs-anchor="c">three</li></ul>').window.document;
const fa=formatted.querySelector('[data-hs-anchor="a"]'),fb=formatted.querySelector('[data-hs-anchor="b"]'),fc=formatted.querySelector('[data-hs-anchor="c"]'),fr=formatted.createRange();fr.setStart(fa.firstChild,0);fr.setEnd(fb,0);assert.equal(singleBlockRange(fr).range.toString(),'one');fr.setEnd(fb.firstChild,1);assert.equal(singleBlockRange(fr),null);fr.setStart(fb.firstChild,0);fr.setEnd(fc,0);assert.equal(singleBlockRange(fr),null,'must not skip even an empty sibling block');
