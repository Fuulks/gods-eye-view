import test from 'node:test';
import assert from 'node:assert/strict';
import { createHubSource } from './source.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const stations = {
  type: 'FeatureCollection',
  origin: 'replayed',
  features: [{ type: 'Feature', id: 's1', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { readings: [] } }],
};

test('creating the source starts no request and no stream', () => {
  let calls = 0;
  class ES { constructor() { calls += 1; } }
  createHubSource({ fetchImpl: async () => { calls += 1; return json({}); }, EventSourceImpl: ES });
  assert.equal(calls, 0);
});

test('requests stay on the same-origin proxy and carry only the three known parameters', async () => {
  const urls = [];
  const source = createHubSource({ fetchImpl: async (url) => { urls.push(url); return json(stations); } });
  const result = await source.getStations('stations', {
    bbox: [1, 2, 3, 4], time: '2026-01-01T00:00:00Z', limit: 7, token: 'x', signal: undefined,
  });
  assert.equal(result.origin, 'replayed');
  assert.equal(urls[0], '/api/hub/layers/stations/features?bbox=1%2C2%2C3%2C4&time=2026-01-01T00%3A00%3A00Z&limit=7');
  await source.getStations('stations');
  assert.equal(urls[1], '/api/hub/layers/stations/features');
  assert.ok(urls.every((u) => u.startsWith('/api/hub/')));
});

test('layer ids are validated before they reach a URL', async () => {
  const source = createHubSource({ fetchImpl: async () => json(stations) });
  for (const id of ['', '../x', 'a/b', 'UP', 'a b', 'x?y=1'])
    await assert.rejects(source.getStations(id), TypeError, id);
});

test('failures and malformed or unlabeled payloads throw instead of drawing', async () => {
  await assert.rejects(createHubSource({ fetchImpl: async () => json({ error: 'hub_not_configured' }, 503) }).getStations('stations'), /HTTP 503/);
  await assert.rejects(createHubSource({ fetchImpl: async () => json({ type: 'FeatureCollection', features: [] }) }).getStations('stations'), /Malformed/);
  await assert.rejects(createHubSource({ fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024)) }).getStations('stations'));
});

test('listLayers returns descriptors or an empty list', async () => {
  assert.deepEqual(await createHubSource({ fetchImpl: async () => json({ layers: [{ id: 'stations' }] }) }).listLayers(), [{ id: 'stations' }]);
  assert.deepEqual(await createHubSource({ fetchImpl: async () => json({ nope: 1 }) }).listLayers(), []);
});

test('subscribe normalizes snapshots, ignores bad frames, reports state and unsubscribes', () => {
  const made = [];
  class ES {
    constructor(url) { this.url = url; this.readyState = 0; this.handlers = {}; this.closed = false; made.push(this); }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    close() { this.closed = true; }
  }
  const got = [];
  const states = [];
  const source = createHubSource({ EventSourceImpl: ES });
  const stop = source.subscribe('stations', (r) => got.push(r), (s) => states.push(s), { limit: 3 });
  const es = made[0];
  assert.equal(es.url, '/api/hub/layers/stations/stream?limit=3');
  es.readyState = 1; es.onopen();
  es.handlers.snapshot({ data: 'not json' });
  es.handlers.snapshot({ data: JSON.stringify({ type: 'FeatureCollection', features: [] }) }); // no origin
  es.handlers.snapshot({ data: JSON.stringify(stations) });
  assert.equal(got.length, 1);
  assert.equal(got[0].origin, 'replayed');
  assert.deepEqual(states, ['open']);
  stop();
  assert.equal(es.closed, true);
});

test('without EventSource the subscription reports closed and does nothing', () => {
  const states = [];
  const stop = createHubSource({ EventSourceImpl: undefined }).subscribe('stations', () => {}, (s) => states.push(s));
  assert.deepEqual(states, ['closed']);
  stop();
});
