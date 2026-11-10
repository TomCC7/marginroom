/**
 * Pure shared revision primitives. All offsets/length limits are UTF-16 units.
 *
 * differences(before, after) returns ordered, non-touching {start,end,old,next}
 * edits in BEFORE coordinates. Grapheme equality is exact (no normalization).
 * Common grapheme prefix/suffix are retained; a shortest insertion/deletion
 * script handles the middle. Myers ties prefer deletion, deterministically.
 * Adjacent script edits coalesce, but unchanged graphemes always split hunks.
 *
 * project(base, hunks) validates and snapshots ordered, disjoint base-coordinate
 * edits, returning {text, forward(offset, bias='left'), backward(offset,
 * bias='left')}. Touching edits are allowed, duplicate insertion sites are not.
 * Maps accept any integer UTF-16 coordinate, including inside unchanged clusters.
 * Unchanged offsets translate exactly; replacement endpoints map to endpoints;
 * edited interiors snap to the left/right endpoint. An insertion's source point
 * maps before/after inserted text according to bias (a deletion does the same
 * backwards). At touching edits, bias selects the outermost available endpoint.
 * Maps are monotone, not bijective inside inserted/deleted/replaced regions.
 *
 * Limits: each input/output <=100,000 UTF-16 units; <=100,000 project hunks;
 * Myers distance <=1,024 and <=2,000,000 diagonal/equality work steps. Exceeding
 * a limit throws RangeError (diff budget failures have code DIFF_BUDGET), never
 * an enclosing replacement or partial result. Invalid types/bias throw TypeError;
 * invalid coordinates/hunks throw RangeError. Intl.Segmenter is required: lack
 * of it throws explicitly, rather than falling back to unsafe code-point edits.
 * No dependencies, DOM, I/O, or mutation of caller-owned data.
 */
const MAX_LENGTH = 100000;
const MAX_DISTANCE = 1024;
const MAX_WORK = 2000000;

function textInput(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  if (value.length > MAX_LENGTH) throw new RangeError(`${name} exceeds ${MAX_LENGTH} UTF-16 units`);
}

function segment(text) {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
    throw new Error('Intl.Segmenter is required for grapheme-safe revisions');
  }
  const parts = [];
  const offsets = [];
  for (const item of new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)) {
    parts.push(item.segment);
    offsets.push(item.index);
  }
  offsets.push(text.length);
  return { parts, offsets };
}

function budgetExceeded() {
  const error = new RangeError('Revision diff computation budget exceeded');
  error.code = 'DIFF_BUDGET';
  throw error;
}

export function differences(before, after) {
  textInput(before, 'before');
  textInput(after, 'after');
  if (before === after) return [];
  const a = segment(before), b = segment(after);
  let prefix = 0;
  while (prefix < a.parts.length && prefix < b.parts.length && a.parts[prefix] === b.parts[prefix]) prefix++;
  let aEnd = a.parts.length, bEnd = b.parts.length;
  while (aEnd > prefix && bEnd > prefix && a.parts[aEnd - 1] === b.parts[bEnd - 1]) { aEnd--; bEnd--; }
  const n = aEnd - prefix, m = bEnd - prefix;
  let operations;
  // Empty-middle edits are linear and need no search budget or trace.
  if (!n || !m) {
    operations = Array(n).fill('-').concat(Array(m).fill('+'));
  } else {
    const limit = Math.min(MAX_DISTANCE, n + m);
    const center = limit + 1;
    const v = new Int32Array(2 * limit + 3).fill(-1);
    v[center + 1] = 0;
    const trace = [];
    let work = 0, distance = -1;
    search: for (let d = 0; d <= limit; d++) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        if (++work > MAX_WORK) budgetExceeded();
        const index = center + k;
        let x = k === -d || (k !== d && v[index - 1] < v[index + 1]) ? v[index + 1] : v[index - 1] + 1;
        let y = x - k;
        while (x < n && y < m && a.parts[prefix + x] === b.parts[prefix + y]) {
          if (++work > MAX_WORK) budgetExceeded();
          x++; y++;
        }
        v[index] = x;
        if (x >= n && y >= m) { distance = d; break search; }
      }
    }
    if (distance < 0) budgetExceeded();
    operations = [];
    let x = n, y = m;
    for (let d = distance; d >= 0; d--) {
      const previous = trace[d], k = x - y;
      const previousK = k === -d || (k !== d && previous[center + k - 1] < previous[center + k + 1]) ? k + 1 : k - 1;
      const previousX = previous[center + previousK], previousY = previousX - previousK;
      while (x > previousX && y > previousY) { operations.push('='); x--; y--; }
      if (d > 0) {
        if (x === previousX) { operations.push('+'); y--; }
        else { operations.push('-'); x--; }
      }
    }
    operations.reverse();
  }
  const hunks = [];
  let ai = prefix, bi = prefix, startA = null, startB = null;
  const flush = () => {
    if (startA === null) return;
    const start = a.offsets[startA], end = a.offsets[ai];
    hunks.push({ start, end, old: before.slice(start, end), next: after.slice(b.offsets[startB], b.offsets[bi]) });
    startA = startB = null;
  };
  for (const operation of operations) {
    if (operation === '=') { flush(); ai++; bi++; }
    else {
      if (startA === null) { startA = ai; startB = bi; }
      if (operation === '-') ai++;
      else bi++;
    }
  }
  flush();
  return hunks;
}

// Binary-searchable monotone edited intervals, with zero-width ambiguity handled
// in both directions. Captured numeric snapshots cannot be changed by callers.
function coordinateMap(intervals, sourceLength, targetLength) {
  return (offset, bias = 'left') => {
    if (!Number.isInteger(offset) || offset < 0 || offset > sourceLength) throw new RangeError('Coordinate outside text');
    if (bias !== 'left' && bias !== 'right') throw new TypeError('Bias must be left or right');
    let lo = 0, hi = intervals.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (intervals[mid].end < offset) lo = mid + 1;
      else hi = mid;
    }
    const first = lo;
    if (first === intervals.length) return offset + targetLength - sourceLength;
    const initial = intervals[first];
    if (initial.start > offset) return offset + initial.toStart - initial.start;
    if (bias === 'right') {
      hi = intervals.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (intervals[mid].start <= offset) lo = mid + 1;
        else hi = mid;
      }
    }
    const item = intervals[bias === 'left' ? first : lo - 1];
    if (item.start === item.end) return bias === 'left' ? item.toStart : item.toEnd;
    if (offset === item.start) return item.toStart;
    if (offset === item.end) return item.toEnd;
    return bias === 'left' ? item.toStart : item.toEnd;
  };
}

export function project(base, hunks) {
  textInput(base, 'base');
  if (!Array.isArray(hunks)) throw new TypeError('hunks must be an array');
  if (hunks.length > MAX_LENGTH) throw new RangeError('Too many hunks');
  const boundaries = new Set(segment(base).offsets);
  const chunks = [], forward = [], backward = [];
  let cursor = 0, length = base.length, delta = 0, previous = null;
  for (const hunk of hunks) {
    if (!hunk || typeof hunk !== 'object') throw new TypeError('Each hunk must be an object');
    const { start, end, old, next } = hunk;
    textInput(old, 'hunk.old');
    textInput(next, 'hunk.next');
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > base.length) throw new RangeError('Invalid hunk range');
    if (start < cursor || (previous && start === previous.start && start === end && previous.start === previous.end)) throw new RangeError('Hunks overlap or are out of order');
    if (!boundaries.has(start) || !boundaries.has(end)) throw new RangeError('Hunk splits a base grapheme');
    if (old !== base.slice(start, end)) throw new RangeError('Hunk old text does not match base');
    if (old === next) throw new RangeError('Hunk must change text');
    length += next.length - (end - start);
    const toStart = start + delta, toEnd = toStart + next.length;
    // Bound the constructed prefix, not a temporary apply-one-edit total: later
    // deletions may offset an early insertion even when base is at the limit.
    if (toEnd > MAX_LENGTH) throw new RangeError('Projected text exceeds size limit');
    forward.push({ start, end, toStart, toEnd });
    backward.push({ start: toStart, end: toEnd, toStart: start, toEnd: end });
    chunks.push(base.slice(cursor, start), next);
    cursor = end;
    delta += next.length - (end - start);
    previous = { start, end };
  }
  if (length > MAX_LENGTH) throw new RangeError('Projected text exceeds size limit');
  chunks.push(base.slice(cursor));
  const text = chunks.join('');
  const outputBoundaries = new Set(segment(text).offsets);
  for (const interval of forward) {
    if (!outputBoundaries.has(interval.toStart) || !outputBoundaries.has(interval.toEnd)) throw new RangeError('Hunk splits a projected grapheme');
  }
  return { text, forward: coordinateMap(forward, base.length, text.length), backward: coordinateMap(backward, text.length, base.length) };
}
