import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GHOST_MARKER_DEFAULT_KIND,
  GHOST_MARKER_KINDS,
  GHOST_MARKER_SIZE,
  clearGhostMarkerCache,
  drawGhostMarker,
  ghostMarkerImage,
  ghostMarkerKind,
  isNeutralTint,
} from './markers.js';

/** A recording 2D context: what was traced, filled and stroked. */
function recorder() {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get: (_t, name) => (...args) => calls.push([String(name), ...args]),
      set: (_t, name, value) => {
        calls.push(['set', String(name), value]);
        return true;
      },
    },
  );
  return { ctx, calls };
}

test('the shape follows the icon name and nothing else in the href', () => {
  assert.equal(ghostMarkerKind('shapes/triangle.png'), 'triangle');
  assert.equal(ghostMarkerKind('images/Placemark_Square.PNG'), 'square');
  assert.equal(ghostMarkerKind('files\\diamond-red.png'), 'diamond');
  assert.equal(ghostMarkerKind('star.png?x=square'), 'star');
  // A directory named for a shape does not pick it.
  assert.equal(ghostMarkerKind('square/icon.png'), GHOST_MARKER_DEFAULT_KIND);
  for (const odd of [null, undefined, '', 'https://x/y.png', 'icon.png', 7])
    assert.equal(ghostMarkerKind(odd), GHOST_MARKER_DEFAULT_KIND);
});

test('white and near-white KML tints are neutral, colours are not', () => {
  assert.equal(isNeutralTint(null), true);
  assert.equal(isNeutralTint([1, 1, 1, 1]), true);
  assert.equal(isNeutralTint([0.97, 0.99, 1, 0.5]), true);
  assert.equal(isNeutralTint([1, 0.2, 0.2, 1]), false);
  assert.equal(isNeutralTint([0, 0, 0, 1]), false);
});

test('every shape is drawn white with a dark outline, and the shapes differ', () => {
  const traces = new Map();
  for (const kind of GHOST_MARKER_KINDS) {
    const { ctx, calls } = recorder();
    drawGhostMarker(ctx, kind, GHOST_MARKER_SIZE);
    const names = calls.map((call) => call[0]);
    assert.ok(names.includes('fill') && names.includes('stroke'), kind);
    assert.ok(
      calls.some((c) => c[0] === 'set' && c[1] === 'fillStyle' && c[2] === '#ffffff'),
      `${kind} is white so the tint carries the colour`,
    );
    traces.set(kind, JSON.stringify(calls));
  }
  assert.equal(new Set(traces.values()).size, GHOST_MARKER_KINDS.length);
});

test('a sprite is drawn once per shape and shared, and an unknown shape is the disc', () => {
  clearGhostMarkerCache();
  let canvases = 0;
  const documentRef = {
    createElement() {
      canvases += 1;
      return {
        getContext: () => recorder().ctx,
        toDataURL: () => `data:image/png;base64,sprite-${canvases}`,
      };
    },
  };
  const a = ghostMarkerImage('square', documentRef);
  const b = ghostMarkerImage('square', documentRef);
  assert.equal(a, b);
  assert.equal(canvases, 1);
  assert.equal(ghostMarkerImage('nonsense', documentRef), ghostMarkerImage('disc', documentRef));
  assert.equal(canvases, 2);
  // No canvas: null, never a throw.
  clearGhostMarkerCache();
  assert.equal(ghostMarkerImage('disc', null), null);
  clearGhostMarkerCache();
});
