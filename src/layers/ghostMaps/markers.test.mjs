import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GHOST_MARKER_DEFAULT_KIND,
  GHOST_MARKER_FRAME_COLOR,
  GHOST_MARKER_KINDS,
  GHOST_MARKER_SIZE,
  clearGhostMarkerCache,
  descriptionTypeText,
  drawGhostMarker,
  ghostEventKind,
  ghostMarkerImage,
} from './markers.js';

/** A recording 2D context: what was traced, filled and stroked. */
function recorder() {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get:
        (_t, name) =>
        (...args) =>
          calls.push([String(name), ...args]),
      set: (_t, name, value) => {
        calls.push(['set', String(name), value]);
        return true;
      },
    },
  );
  return { ctx, calls };
}

const table = (label, value) =>
  `<table><tr><td>${label}</td><td>${value}</td></tr></table>`;

test('the kind comes from what the placemark says about itself', () => {
  const cases = [
    [{ name: 'Ballistic missile launch' }, 'missile'],
    [{ name: 'Shahed-136 intercepted' }, 'drone'],
    [{ name: 'Airstrike on depot' }, 'air'],
    [{ folder: 'Naval incidents', name: 'Tanker attacked' }, 'naval'],
    [{ name: 'Explosion reported' }, 'strike'],
    [{ name: 'Artillery shelling' }, 'strike'],
    [{ name: 'Ambush on convoy' }, 'clash'],
    [{ name: 'Warehouse fire' }, 'fire'],
    [{ name: '12 killed in market' }, 'casualty'],
    [{ name: 'Protest in the square' }, 'unrest'],
    [{ name: 'Border crossing closed' }, 'checkpoint'],
    [{ name: 'Refugee camp expanded' }, 'displacement'],
    [{ name: 'Air base' }, 'facility'],
    [{ name: 'Something happened' }, 'report'],
    [{}, 'report'],
  ];
  for (const [placemark, kind] of cases)
    assert.equal(ghostEventKind(placemark), kind, JSON.stringify(placemark));
});

test('the more specific kind wins over the general one', () => {
  // A drone strike is a drone; a missile strike is a missile; an airstrike is air.
  assert.equal(ghostEventKind({ name: 'Drone strike on base' }), 'drone');
  assert.equal(ghostEventKind({ name: 'Missile strike' }), 'missile');
  assert.equal(ghostEventKind({ name: 'Air strike on port' }), 'air');
});

test('the Type row of the popup table leads, the long description is not scanned', () => {
  const html =
    table('Event Type', 'Drone') + table('Notes', 'Fire and explosions nearby');
  assert.equal(descriptionTypeText(html), 'Drone');
  assert.equal(
    ghostEventKind({ name: 'Report 4411', description: html }),
    'drone',
  );
  // Words only in the notes do not classify the placemark.
  assert.equal(
    ghostEventKind({
      name: 'Report 4412',
      description: table('Notes', 'a fire and a missile'),
    }),
    'report',
  );
  assert.equal(descriptionTypeText('<p>no table</p>'), '');
  assert.equal(descriptionTypeText(null), '');
});

test('the icon file name and the folder are read, the path and extension are not', () => {
  assert.equal(
    ghostEventKind({ name: 'x', iconHref: 'files/drone_red.png' }),
    'drone',
  );
  assert.equal(
    ghostEventKind({ name: 'x', folder: 'Checkpoints' }),
    'checkpoint',
  );
  assert.equal(
    ghostEventKind({ name: 'x', iconHref: 'fire/icon.png' }),
    'report',
  );
  assert.equal(
    ghostEventKind({ name: 'x', iconHref: 'https://x/y.png?drone' }),
    'report',
  );
});

test('every kind is drawn as a cyan plate with a glyph, and the glyphs differ', () => {
  const traces = new Map();
  for (const kind of GHOST_MARKER_KINDS) {
    const { ctx, calls } = recorder();
    drawGhostMarker(ctx, kind, GHOST_MARKER_SIZE);
    assert.ok(
      calls.some(
        (c) =>
          c[0] === 'set' &&
          c[1] === 'strokeStyle' &&
          c[2] === GHOST_MARKER_FRAME_COLOR,
      ),
      `${kind} has the cyan frame`,
    );
    assert.ok(
      calls.filter((c) => c[0] === 'stroke').length >= 2,
      `${kind} draws a glyph`,
    );
    traces.set(kind, JSON.stringify(calls));
  }
  assert.equal(new Set(traces.values()).size, GHOST_MARKER_KINDS.length);
  assert.equal(GHOST_MARKER_KINDS.at(-1), GHOST_MARKER_DEFAULT_KIND);
});

test('a sprite is drawn once per kind and shared, and an unknown kind is the report symbol', () => {
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
  const a = ghostMarkerImage('drone', documentRef);
  assert.equal(ghostMarkerImage('drone', documentRef), a);
  assert.equal(canvases, 1);
  assert.equal(
    ghostMarkerImage('nonsense', documentRef),
    ghostMarkerImage('report', documentRef),
  );
  assert.equal(canvases, 2);
  clearGhostMarkerCache();
  assert.equal(ghostMarkerImage('report', null), null);
  clearGhostMarkerCache();
});
