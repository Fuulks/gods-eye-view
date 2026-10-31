import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEntityCard,
  createEntityCardOverlayEntry,
  pickedEntityId,
} from './entityCard.js';

function harness(overrides = {}) {
  const calls = [];
  const overlayHost = {
    setEntries: (...args) => calls.push(['set', ...args]),
    clearSource: (...args) => calls.push(['clear', ...args]),
    setVisible: (...args) => calls.push(['visible', ...args]),
  };
  const card = createEntityCard({
    layerId: 'demo',
    overlayHost,
    sourceId: 'demo-selected',
    owns: (id) => id.startsWith('demo:'),
    resolve: (id) =>
      id === 'demo:a'
        ? { title: 'A', details: ['one'], accent: '#fff', position: { x: 1 } }
        : null,
    ...overrides,
  });
  return { card, calls };
}

test('a pick id is read from an entity, a string id or a primitive id', () => {
  assert.equal(pickedEntityId({ id: 'x' }), 'x');
  assert.equal(pickedEntityId({ id: { id: 'y' } }), 'y');
  assert.equal(pickedEntityId({ primitive: { id: 'z' } }), 'z');
  assert.equal(pickedEntityId(null), null);
  assert.equal(pickedEntityId({ id: 7 }), null);
});

test('selecting an owned id publishes one selected card', () => {
  const { card, calls } = harness();
  assert.equal(card.select('demo:a'), true);
  assert.equal(card.selectedId, 'demo:a');
  const [kind, source, entries, options] = calls.at(-1);
  assert.equal(kind, 'set');
  assert.equal(source, 'demo-selected');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, 'A');
  assert.equal(entries[0].selected, true);
  assert.equal(options.cohortLimit, 1);
});

test('an id the layer cannot resolve opens nothing', () => {
  const { card, calls } = harness();
  assert.equal(card.select('demo:gone'), false);
  assert.equal(card.selectedId, null);
  assert.equal(calls.length, 0);
});

test('clear closes the card once and tells the layer', () => {
  let cleared = 0;
  const { card, calls } = harness({ onClear: () => (cleared += 1) });
  card.select('demo:a');
  card.clear();
  card.clear();
  assert.equal(cleared, 1);
  assert.equal(calls.filter((call) => call[0] === 'clear').length, 2);
});

test('an overlay entry needs an id and an anchor', () => {
  assert.equal(
    createEntityCardOverlayEntry('', { x: 1 }, { title: 't' }),
    null,
  );
  assert.equal(createEntityCardOverlayEntry('a', null, { title: 't' }), null);
});

test('remove without install is safe and releases the slot', () => {
  const { card, calls } = harness();
  card.remove();
  assert.deepEqual(calls.at(-1), ['visible', 'demo-selected', false]);
});
