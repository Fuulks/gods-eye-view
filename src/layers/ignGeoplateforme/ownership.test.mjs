import assert from 'node:assert/strict';
import test from 'node:test';
import { createIgnGeoplateformeLayer } from './index.js';

function harness(descriptor) {
  const added = [];
  const viewer = {
    imageryLayers: {
      addImageryProvider(provider) {
        added.push(provider);
        return { show: true, provider };
      },
      remove(provider) {
        const index = added.indexOf(provider);
        if (index >= 0) added.splice(index, 1);
      },
    },
  };
  const layer = createIgnGeoplateformeLayer({
    source: { getDescriptor: () => descriptor },
  });
  layer.init(viewer);
  return { layer, viewer, added };
}

const descriptor = () => ({
  url: '/api/ign-geoplateforme/tiles/PLANIGNV2/{z}/{x}/{y}.png',
  layer: 'PLANIGNV2',
  tileMatrixSet: 'PM_0_19',
  maximumLevel: 19,
  credit: 'IGN',
});

test('the layer requires a descriptor source', () => {
  assert.throws(() => createIgnGeoplateformeLayer({}), /source/);
});

test('a layer cannot be initialized twice', () => {
  const { layer, viewer } = harness(descriptor());
  assert.throws(() => layer.init(viewer), /already/);
});

test('enabling adds the imagery layer through the local proxy template', () => {
  const { layer, viewer, added } = harness(descriptor());
  layer.enable(viewer);
  assert.equal(added.length, 1);
  // The provider exposes the template through its public `url` accessor.
  assert.ok(
    added[0].url.startsWith('/api/ign-geoplateforme/tiles/'),
    'the browser must not name an upstream URL',
  );
  assert.equal(layer.getStats().count, 1);
  layer.destroy(viewer);
});

test('the layer offers no vector cadastre, because the upstream is unreliable', () => {
  const { layer, viewer } = harness(descriptor());
  layer.enable(viewer);
  const { summary } = layer.getRowControls();
  assert.match(summary.status, /vector cadastre unavailable/i);
  layer.destroy(viewer);
});

test('destroy removes the imagery layer', () => {
  const { layer, viewer, added } = harness(descriptor());
  layer.enable(viewer);
  layer.destroy(viewer);
  assert.equal(added.length, 0);
  assert.equal(layer.getStats().count, 0);
});
