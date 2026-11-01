import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHubStations, cleanText, HUB_MAX_FEATURES } from './records.js';

const feature = (over = {}) => ({
  type: 'Feature',
  id: 'station-sim-01',
  geometry: { type: 'Point', coordinates: [12.3, 45.7] },
  properties: {
    location_precision_m: 11100,
    readings: [
      { sensor_id: 'bme280-sim-01', metric: 'temperature', value: 21.5, unit: 'C', observed_at: '2026-01-15T12:10:00.000000Z' },
    ],
  },
  ...over,
});
const collection = (features, over = {}) => ({
  type: 'FeatureCollection',
  origin: 'simulated',
  features,
  ...over,
});

test('a valid collection becomes plain display records that keep their origin', () => {
  const result = normalizeHubStations(collection([feature()]));
  assert.equal(result.origin, 'simulated');
  assert.equal(result.dropped, 0);
  assert.deepEqual(result.rows[0], {
    id: 'station-sim-01',
    lon: 12.3,
    lat: 45.7,
    origin: 'simulated',
    precisionM: 11100,
    readings: [
      { sensorId: 'bme280-sim-01', metric: 'temperature', value: 21.5, unit: 'C', observedAt: '2026-01-15T12:10:00.000000Z' },
    ],
  });
});

test('a collection that does not state a valid origin is not shown at all', () => {
  for (const origin of [undefined, null, '', 'LIVE', 'real', 'live ', {}]) {
    assert.equal(normalizeHubStations(collection([feature()], { origin })), null, String(origin));
  }
});

test('anything that is not a feature collection is refused', () => {
  for (const value of [null, undefined, 3, 'x', [], {}, { type: 'FeatureCollection' }, { type: 'Feature' }])
    assert.equal(normalizeHubStations(value), null);
});

test('stations without a usable id or position are dropped and counted', () => {
  const result = normalizeHubStations(
    collection(
      [
        feature({ id: '<img src=x onerror=alert(1)>' }),
        feature({ id: 'ok-1', geometry: null }),
        feature({ id: 'ok-2', geometry: { type: 'Point', coordinates: [181, 0] } }),
        feature({ id: 'ok-3', geometry: { type: 'Point', coordinates: [0, 91] } }),
        feature({ id: 'ok-4', geometry: { type: 'Point', coordinates: ['1', '2'] } }),
        feature({ id: 'ok-5', geometry: { type: 'Point', coordinates: [NaN, 2] } }),
        feature({ id: 'ok-6', geometry: { type: 'Polygon', coordinates: [] } }),
        feature({ id: 'good' }),
      ],
      { dropped_invalid: 2 },
    ),
  );
  assert.deepEqual(result.rows.map((r) => r.id), ['good']);
  assert.equal(result.dropped, 2 + 7);
});

test('hostile text never survives: unknown fields are ignored and strings are bounded and flattened', () => {
  const hostile = `<script>alert(1)</script>‮${'x'.repeat(500)}\n\u0000`;
  const result = normalizeHubStations(
    collection([
      feature({
        title: hostile,
        properties: {
          note: hostile,
          readings: [
            { sensor_id: 'bme280-sim-01', metric: hostile, value: 1, unit: hostile, observed_at: hostile },
            { sensor_id: '<b>x</b>', metric: 'temperature', value: 1 },
            { sensor_id: 'ok', metric: 'temperature', value: '1' },
            { sensor_id: 'ok', metric: 'temperature', value: Infinity },
          ],
        },
      }),
    ]),
  );
  const [row] = result.rows;
  assert.equal(row.readings.length, 1);
  const r = row.readings[0];
  assert.ok(r.metric.length <= 32 && r.unit.length <= 16 && r.observedAt.length <= 40);
  assert.ok(!/[\u0000-\u001f‮]/.test(JSON.stringify(r).replace(/\\u[0-9a-f]{4}/gi, '')));
  assert.ok(!('title' in row) && !('note' in row));
});

test('feature and reading counts are bounded', () => {
  const many = Array.from({ length: HUB_MAX_FEATURES + 50 }, (_, i) => feature({ id: `s-${i}` }));
  assert.equal(normalizeHubStations(collection(many)).rows.length, HUB_MAX_FEATURES);
  const readings = Array.from({ length: 100 }, () => ({ sensor_id: 'a', metric: 'm', value: 1 }));
  assert.equal(normalizeHubStations(collection([feature({ properties: { readings } })])).rows[0].readings.length, 32);
});

test('cleanText flattens control characters and bidi overrides', () => {
  assert.equal(cleanText('a\nb‮c'), 'a b c');
  assert.equal(cleanText('   '), null);
  assert.equal(cleanText(5), null);
});
