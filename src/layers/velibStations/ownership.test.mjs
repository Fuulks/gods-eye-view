import assert from 'node:assert/strict';
import test from 'node:test';
import { createVelibStationsLayer } from './index.js';

function harness(source) {
  const sources = [];
  const events = [];
  const viewer = {
    dataSources: {
      add(value) {
        sources.push(value);
      },
      remove(value) {
        sources.splice(sources.indexOf(value), 1);
      },
    },
  };
  const layer = createVelibStationsLayer({
    source,
    overlayHost: {
      setEntries(...args) {
        events.push(args);
      },
      setVisible() {},
      clearSource() {},
    },
  });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, sources, events };
}

const SNAPSHOT = {
  stations: [
    {
      id: 'a',
      name: 'Station A',
      code: '16107',
      lon: 2.275725,
      lat: 48.865983,
      capacity: 35,
      bikes: 4,
      eBikes: 2,
      mechanical: 2,
      docks: 30,
      installed: true,
      renting: true,
      returning: true,
      band: 'low',
      color: '#ff7f0e',
    },
  ],
  total: 1,
};

test('a layer requires its source and an overlay host', () => {
  assert.throws(() => createVelibStationsLayer({}), /source/);
  assert.throws(
    () => createVelibStationsLayer({ source: { getSnapshot: async () => [] } }),
    /overlay host/,
  );
});

test('a layer cannot be initialized twice', () => {
  const { layer, viewer } = harness({ getSnapshot: async () => SNAPSHOT });
  assert.throws(() => layer.init(viewer), /already/);
});

test('a disabled layer does not fetch', async () => {
  let calls = 0;
  const layer = createVelibStationsLayer({
    source: {
      getSnapshot: async () => {
        calls += 1;
        return SNAPSHOT;
      },
    },
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  layer.init({ dataSources: { add() {}, remove() {} } });
  assert.equal(await layer.update(), false);
  assert.equal(calls, 0);
});

test('a refresh publishes the snapshot and the row states the coverage', async () => {
  const { layer } = harness({ getSnapshot: async () => SNAPSHOT });
  assert.equal(await layer.update(), true);
  const stats = layer.getStats();
  assert.equal(stats.count, 1);
  assert.equal(stats.total, 1);
  assert.equal(stats.bikes, 4);
  assert.equal(stats.error, null);
  const summary = layer.getRowControls().summary;
  assert.match(summary.coverage, /Vélib/);
  assert.ok(summary.validTime);
});

test('a late refresh cannot publish after disable or destroy', async () => {
  for (const action of ['disable', 'destroy']) {
    let resolve;
    let signal;
    const h = harness({
      getSnapshot(options) {
        signal = options.signal;
        return new Promise((done) => {
          resolve = done;
        });
      },
    });
    const pending = h.layer.update(h.viewer);
    h.layer[action](h.viewer);
    assert.equal(signal.aborted, true);
    if (action === 'disable') h.layer.enable(h.viewer);
    resolve(SNAPSHOT);
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().count, 0);
    assert.equal(h.events.length, 0);
    h.layer.destroy(h.viewer);
  }
});

test('two displays own separate data sources and destruction', async () => {
  const a = harness({ getSnapshot: async () => SNAPSHOT });
  const b = harness({ getSnapshot: async () => SNAPSHOT });
  await a.layer.update(a.viewer);
  await b.layer.update(b.viewer);
  a.layer.destroy();
  assert.equal(a.sources.length, 0);
  assert.equal(b.sources.length, 1);
  b.layer.destroy();
});

test('the analyst records are only served while the layer is enabled', async () => {
  const { layer } = harness({ getSnapshot: async () => SNAPSHOT });
  await layer.update();
  assert.equal(layer.getAnalystRecords().length, 1);
  layer.disable();
  assert.equal(layer.getAnalystRecords().length, 0);
});
