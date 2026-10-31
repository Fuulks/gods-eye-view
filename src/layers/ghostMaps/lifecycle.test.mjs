import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import {
  GHOST_MARKER_DISPLAY_SCALE,
  GHOST_MARKER_TINT_FLOOR,
  clearGhostMarkerCache,
  ghostMarkerTint,
  isNeutralTint,
} from './markers.js';
import { createGhostMapsLayer } from './index.js';

function element(localName, children = [], value = '', attributes = {}) {
  const node = {
    localName,
    children,
    get textContent() {
      return value + children.map((child) => child.textContent).join('');
    },
    getAttribute: (key) => attributes[key] ?? null,
    getElementsByTagName(name) {
      return children.flatMap((child) => [
        ...(name === '*' || name === child.localName ? [child] : []),
        ...child.getElementsByTagName(name),
      ]);
    },
  };
  for (const child of children) child.parentElement = node;
  return node;
}

function documentFixture() {
  return element('document', [
    element('kml', [
      element('Document', [
        element(
          'Style',
          [
            element('IconStyle', [
              element('Icon', [element('href', [], 'icon.png')]),
            ]),
          ],
          '',
          { id: 'pin' },
        ),
        element('Placemark', [
          element('name', [], 'Test report'),
          element('styleUrl', [], '#pin'),
          element('Point', [element('coordinates', [], '12,34')]),
        ]),
      ]),
    ]),
  ]);
}

// A stored KMZ with a local icon; the XML DOM double supplies its one point.
function fixtureKmz() {
  const files = [
    ['doc.kml', '<kml/>'],
    ['icon.png', 'packed icon'],
  ];
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, value] of files) {
    const key = Buffer.from(name);
    const bytes = Buffer.from(value);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(key.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt32LE(bytes.length, 20);
    directory.writeUInt32LE(bytes.length, 24);
    directory.writeUInt16LE(key.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(header, key, bytes);
    central.push(directory, key);
    offset += header.length + key.length + bytes.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, directory, end]));
}

function fixture(t, { beforeFileReturns, onCreateUrl } = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
  globalThis.DOMParser = class {
    parseFromString() {
      return documentFixture();
    }
  };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'DOMParser', previous);
    else delete globalThis.DOMParser;
  });
  const created = [];
  const revoked = [];
  t.mock.method(URL, 'createObjectURL', () => {
    const url = `blob:local-${created.length}`;
    created.push(url);
    onCreateUrl?.(layer);
    return url;
  });
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  t.mock.method(console, 'warn', () => {});
  const mounted = new Set();
  const viewer = {
    scene: { requestRender() {} },
    dataSources: {
      async add(dataSource) {
        mounted.add(dataSource);
        return dataSource;
      },
      remove(dataSource) {
        return mounted.delete(dataSource);
      },
    },
  };
  const layer = createGhostMapsLayer({
    storage: null,
    source: {
      getCatalog: async () => ({
        products: [{ id: 'cip', version: 'a'.repeat(40), defaultOn: true }],
      }),
      getFile: async () => {
        beforeFileReturns?.(layer);
        return fixtureKmz();
      },
    },
  });
  layer.init(viewer);
  layer.enable();
  t.after(() => layer.destroy());
  return { layer, viewer, mounted, created, revoked };
}

test('cancelling a file read mounts nothing and allocates no URLs', async (t) => {
  const { layer, viewer, mounted, created, revoked } = fixture(t, {
    beforeFileReturns: (layer) => queueMicrotask(() => layer.disable()),
  });
  await layer.update(viewer);
  assert.equal(created.length, 0);
  assert.equal(revoked.length, 0);
  assert.equal(mounted.size, 0);
});

test('a load never decodes the packed icons: no object URL is created, kept or revoked', async (t) => {
  const { layer, viewer, mounted, created, revoked } = fixture(t);
  await layer.update(viewer);
  assert.equal(created.length, 0);
  assert.equal(mounted.size, 1);
  assert.equal(layer.getStats().count, 1);
  layer.disable();
  assert.equal(created.length, 0);
  assert.equal(revoked.length, 0);
  assert.equal(mounted.size, 0);
});

test('a placemark is drawn as a shared symbol at the display scale, with no tint', async (t) => {
  const { layer, viewer, mounted } = fixture(t);
  await layer.update(viewer);
  const [dataSource] = [...mounted];
  const [entity] = dataSource.entities.values;
  // The symbol carries its own colour: nothing may tint it.
  assert.equal(entity.billboard.color, undefined);
  assert.equal(entity.billboard.scale.getValue(), GHOST_MARKER_DISPLAY_SCALE);
});

test('entity construction failure leaves nothing mounted and reports the error', async (t) => {
  const { layer, viewer, mounted, created } = fixture(t);
  t.mock.method(Cesium.EntityCollection.prototype, 'add', () => {
    throw new Error('fixture entity failure');
  });
  await layer.update(viewer);
  assert.equal(created.length, 0);
  assert.equal(mounted.size, 0);
  assert.equal(layer.getStats().error, 'fixture entity failure');
});

test('a placemark always has an image, and it is never tinted out of sight', async (t) => {
  clearGhostMarkerCache();
  const { layer, viewer, mounted } = fixture(t);
  await layer.update(viewer);
  const [dataSource] = [...mounted];
  const [entity] = dataSource.entities.values;
  // The marker must have an image: a null image is a placemark drawn as
  // nothing at all, which is what the user sees when the sprites are missing.
  const image = entity.billboard.image?.getValue
    ? entity.billboard.image.getValue()
    : entity.billboard.image;
  assert.ok(image, 'the billboard has an image');
  assert.equal(typeof image, 'string');
  assert.match(image, /^data:image\//);
  // And it must not be tinted: a tint is multiplied into the texture, so a
  // black or transparent tint erases the symbol on a dark globe.
  assert.equal(entity.billboard.color, undefined);
  clearGhostMarkerCache();
});

test('the ArcGIS icon colour, which is always black, does not tint the marker black', () => {
  // The black an ArcGIS export writes into its styles (ff000000) is a
  // placeholder that means "use the product colour": a marker tinted with it
  // would be black, and a black marker on a dark globe cannot be seen.
  const product = { r: 200 / 255, g: 1, b: 0 };
  const tint = ghostMarkerTint([0, 0, 0, 1], product);
  assert.equal(isNeutralTint([0, 0, 0, 1]), true);
  assert.deepEqual(tint, { r: product.r, g: product.g, b: product.b, a: 1 });
  assert.ok(
    tint.r + tint.g + tint.b > 0,
    'the marker is not black on a dark globe',
  );
});

test('a faint KML colour still leaves the marker visible', () => {
  // 40xxxxxx is a quarter opaque. Multiplied into the texture it would fade
  // the symbol away, so the alpha has a floor.
  const product = { r: 0, g: 0, b: 1 };
  const tint = ghostMarkerTint([0, 0, 1, 0.25], product);
  assert.equal(tint.a, GHOST_MARKER_TINT_FLOOR);
  assert.ok(tint.a >= 0.35, 'the marker is not faded away');
  // A fully transparent colour would erase it outright.
  assert.equal(
    ghostMarkerTint([0, 0, 1, 0], product).a,
    GHOST_MARKER_TINT_FLOOR,
  );
});
