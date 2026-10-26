import assert from 'node:assert/strict';
import test from 'node:test';
import { createSncfStationsLayer } from './index.js';

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
  const layer = createSncfStationsLayer({
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

test('a layer requires its source and an overlay host', () => {
  assert.throws(() => createSncfStationsLayer({}), /source/);
  assert.throws(
    () => createSncfStationsLayer({ source: { getSnapshot: async () => [] } }),
    /overlay host/,
  );
});

test('a layer cannot be initialized twice', () => {
  const { layer, viewer } = harness({ getSnapshot: async () => [] });
  assert.throws(() => layer.init(viewer), /already/);
});

test('a disabled layer does not fetch', async () => {
  let calls = 0;
  const layer = createSncfStationsLayer({
    source: {
      getSnapshot: async () => {
        calls += 1;
        return { stations: [], total: 0 };
      },
    },
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  layer.init({ dataSources: { add() {}, remove() {} } });
  assert.equal(await layer.update(), false);
  assert.equal(calls, 0);
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
    resolve({ stations: [], total: 0 });
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().count, 0);
    assert.equal(h.events.length, 0);
    h.layer.destroy(h.viewer);
  }
});

test('two displays own separate data sources and destruction', async () => {
  const a = harness({ getSnapshot: async () => ({ stations: [], total: 0 }) });
  const b = harness({ getSnapshot: async () => ({ stations: [], total: 0 }) });
  await a.layer.update(a.viewer);
  await b.layer.update(b.viewer);
  a.layer.destroy();
  assert.equal(a.sources.length, 0);
  assert.equal(b.sources.length, 1);
  b.layer.destroy();
});
test('the layer is the station network, not live train telemetry', () => {
  const h = harness({ getSnapshot: async () => ({ stations: [], total: 0 }) });
  const { summary } = h.layer.getRowControls();
  assert.match(summary.coverage, /station network/i);
  // The row states what the data is NOT: the phrase appears only inside the
  // disclaimer, so match the disclaimer rather than banning the words.
  assert.match(summary.coverage, /not live train/i);
  assert.doesNotMatch(summary.coverage, /GPS/i);
  h.layer.destroy();
});
