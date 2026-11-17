import test from './helpers/check.mjs';
import assert from 'node:assert/strict';
import { differences, project } from '../public/revision-diff.js';

const h = (start, end, old, next) => ({ start, end, old, next });

await test('separate edits stay separate and whitespace is exact', () => {
  assert.deepEqual(differences('abcdefghij', 'abXdefgYij'), [h(2, 3, 'c', 'X'), h(7, 8, 'h', 'Y')]);
  const before = ' a\tb\r\nc  ', after = '  a\tb\nc ';
  assert.equal(project(before, differences(before, after)).text, after);
  assert.deepEqual(differences(before, before), []);
});

await test('insertions, deletions, and empty inputs', () => {
  assert.deepEqual(differences('', 'hi'), [h(0, 0, '', 'hi')]);
  assert.deepEqual(differences('hi', ''), [h(0, 2, 'hi', '')]);
  assert.deepEqual(differences('abcd', 'abXYcd'), [h(2, 2, '', 'XY')]);
  assert.deepEqual(differences('abXYcd', 'abcd'), [h(2, 4, 'XY', '')]);
});

await test('graphemes are indivisible, with UTF-16 offsets', () => {
  for (const [before, after, expected] of [
    ['a👩‍💻b', 'a👨‍💻b', [h(1, 6, '👩‍💻', '👨‍💻')]],
    ['ae\u0301z', 'ae\u0300z', [h(1, 3, 'e\u0301', 'e\u0300')]],
    ['x🇺🇸y', 'x🇨🇦y', [h(1, 5, '🇺🇸', '🇨🇦')]],
    ['a', 'a\u0301', [h(0, 1, 'a', 'a\u0301')]],
  ]) {
    assert.deepEqual(differences(before, after), expected);
    assert.equal(project(before, expected).text, after);
  }
});

await test('repeated text has a stable prefix-first alignment', () => {
  assert.deepEqual(differences('aaaa', 'aaa'), [h(3, 4, 'a', '')]);
  assert.deepEqual(differences('ababab', 'abXabab'), [h(2, 2, '', 'X')]);
  const expected = differences('abcabc', 'acbacb');
  for (let i = 0; i < 20; i++) assert.deepEqual(differences('abcabc', 'acbacb'), expected);
});

await test('long sparse edits do not become one enclosing replacement', () => {
  const before = 'a'.repeat(100) + 'Q' + 'b'.repeat(79899) + 'R' + 'c'.repeat(9999);
  const after = before.slice(0, 100) + 'X' + before.slice(101, 80000) + 'Y' + before.slice(80001);
  const edits = differences(before, after);
  assert.deepEqual(edits, [h(100, 101, 'Q', 'X'), h(80000, 80001, 'R', 'Y')]);
  assert.equal(project(before, edits).text, after);
});

await test('mapping insertions and deletions has explicit left/right bias', () => {
  const inserted = project('abcd', [h(2, 2, '', 'XY')]);
  assert.equal(inserted.text, 'abXYcd');
  assert.equal(inserted.forward(2), 2);
  assert.equal(inserted.forward(2, 'right'), 4);
  assert.equal(inserted.forward(3), 5);
  assert.equal(inserted.backward(3), 2);
  assert.equal(inserted.backward(3, 'right'), 2);
  const deleted = project('abXYcd', [h(2, 4, 'XY', '')]);
  assert.equal(deleted.forward(3), 2);
  assert.equal(deleted.backward(2), 2);
  assert.equal(deleted.backward(2, 'right'), 4);
  assert.equal(deleted.backward(3), 5);
});

await test('replacement mapping snaps interiors; unchanged offsets round-trip', () => {
  const p = project('0123456789', [h(2, 5, '234', 'AB'), h(8, 9, '8', 'XYZ')]);
  assert.equal(p.text, '01AB567XYZ9');
  assert.equal(p.forward(3), 2);
  assert.equal(p.forward(3, 'right'), 4);
  assert.equal(p.forward(2), 2);
  assert.equal(p.forward(5), 4);
  assert.equal(p.backward(3), 2);
  assert.equal(p.backward(3, 'right'), 5);
  for (const pos of [0, 1, 5, 6, 7, 9, 10]) assert.equal(p.backward(p.forward(pos)), pos);
  assert.throws(() => p.forward(-1), RangeError);
  assert.throws(() => p.backward(12), RangeError);
  assert.throws(() => p.forward(1, 'middle'), TypeError);
});

await test('invalid or excessive work fails explicitly, never partially', () => {
  assert.throws(() => differences(null, ''), TypeError);
  assert.throws(() => differences('x'.repeat(100001), ''), RangeError);
  assert.throws(() => differences('a'.repeat(2000), 'b'.repeat(2000)), /budget/i);
  assert.throws(() => project('abc', [h(0, 1, 'z', 'x')]), /old/i);
  assert.throws(() => project('abc', [h(1, 3, 'bc', ''), h(0, 1, 'a', '')]), /order|overlap/i);
  assert.throws(() => project('😀', [h(0, 1, '\ud83d', '')]), /grapheme/i);
  assert.throws(() => project('a', [h(1, 1, '', '\u0301')]), /grapheme/i);
  assert.throws(() => project('x'.repeat(100000), [h(0, 0, '', 'y')]), RangeError);
});

await test('touching edits, captured snapshots, and final size limits', () => {
  const edits = [h(0, 1, 'a', ''), h(1, 2, 'b', ''), h(2, 2, '', 'X')];
  const p = project('abc', edits);
  assert.equal(p.text, 'Xc');
  assert.equal(p.backward(0, 'left'), 0);
  assert.equal(p.backward(0, 'right'), 2);
  assert.equal(p.forward(2, 'left'), 0);
  assert.equal(p.forward(2, 'right'), 1);
  edits[0].end = 99;
  assert.equal(p.backward(0, 'right'), 2);
  const base = 'a'.repeat(100000);
  assert.equal(project(base, [h(0, 0, '', 'X'), h(99999, 100000, 'a', '')]).text.length, 100000);
  assert.throws(() => project('a', [h(0, 0, '', 'X'), h(0, 0, '', 'Y')]), /order|overlap/i);
});

await test('exhaustive small strings reconstruct exactly with disjoint hunks', () => {
  const words = [''];
  for (let n = 1; n <= 4; n++) {
    for (let bits = 0; bits < 2 ** n; bits++) words.push(bits.toString(2).padStart(n, '0'));
  }
  for (const before of words) for (const after of words) {
    const edits = differences(before, after);
    assert.equal(project(before, edits).text, after);
    const dp = Array.from({ length: before.length + 1 }, (_, i) => [i]);
    for (let j = 0; j <= after.length; j++) dp[0][j] = j;
    for (let i = 1; i <= before.length; i++) for (let j = 1; j <= after.length; j++) {
      dp[i][j] = before[i - 1] === after[j - 1] ? dp[i - 1][j - 1] : Math.min(dp[i - 1][j], dp[i][j - 1]) + 1;
    }
    assert.equal(edits.reduce((cost, edit) => cost + edit.old.length + edit.next.length, 0), dp[before.length][after.length]);
    for (let i = 1; i < edits.length; i++) assert.ok(edits[i - 1].end < edits[i].start);
  }
});
