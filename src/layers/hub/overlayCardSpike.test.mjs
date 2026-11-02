// Spike for the station card: can the world overlay's `card` variant carry multi-line text safely?
// Findings are recorded in docs/ONEINTOS-HUB.md ("Station card spike"). These tests pin what the spike observed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeOverlayEntry } from '../../overlays/worldOverlay.js';
import { measureOverlayEntry } from '../../overlays/worldOverlayDraw.js';

const TEST_LIMIT_MS = 10000;
const ctx = { font: '', measureText: (t) => ({ width: String(t).length * 6 }) };
const HOSTILE = '<img src=x onerror=alert(1)>';

function card(details) {
  return normalizeOverlayEntry('spike', {
    id: 's',
    position: { x: 1, y: 2, z: 3 },
    variant: 'card',
    title: HOSTILE,
    details,
  });
}

test(
  'the card variant keeps one string per detail line, markup untouched',
  { timeout: TEST_LIMIT_MS },
  () => {
    const e = card(['one', HOSTILE, 3]);
    assert.equal(e.variant, 'card');
    assert.deepEqual(e.details, ['one', HOSTILE, '3']);
    assert.equal(e.title, HOSTILE);
  },
);

test(
  'the card grows by one line height per detail line and widens to the longest line',
  { timeout: TEST_LIMIT_MS },
  () => {
    const small = measureOverlayEntry(ctx, card(['a']), {});
    const big = measureOverlayEntry(
      ctx,
      card(['a', 'b', 'c', 'd', 'e', 'f']),
      {},
    );
    assert.equal(big.h - small.h, 5 * small.lineH);
    const wide = measureOverlayEntry(ctx, card(['x'.repeat(200)]), {});
    assert.ok(
      wide.w > 1000,
      'there is no wrapping or truncation: a long line makes a very wide card',
    );
  },
);

test(
  'overlay text is painted with fillText on a canvas, never through the DOM',
  { timeout: TEST_LIMIT_MS },
  () => {
    const draw = readFileSync(
      new URL('../../overlays/worldOverlayDraw.js', import.meta.url),
      'utf8',
    );
    assert.match(draw, /fillText\(/);
    assert.doesNotMatch(
      draw,
      /innerHTML|insertAdjacentHTML|outerHTML|\.textContent\s*=/,
    );
  },
);

test(
  'a card is clickable only through hit rectangles and an accessibility button mirror, not DOM text',
  { timeout: TEST_LIMIT_MS },
  () => {
    const src = readFileSync(
      new URL('../../overlays/worldOverlay.js', import.meta.url),
      'utf8',
    );
    assert.match(src, /export function hitTestWorldOverlay/);
    assert.match(src, /button\.textContent = item\.label/); // only the accessibility mirror uses textContent, one label per button
  },
);
