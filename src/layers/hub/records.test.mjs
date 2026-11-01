import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHubStations,
  cleanText,
  HUB_MAX_FEATURES,
} from './records.js';

const feature = (over = {}) => ({
  type: 'Feature',
  id: 'station-sim-01',
  geometry: { type: 'Point', coordinates: [12.3, 45.7] },
  properties: {
    location_precision_m: 11100,
    readings: [
      {
        sensor_id: 'bme280-sim-01',
        metric: 'temperature',
        value: 21.5,
        unit: 'C',
        observed_at: '2026-01-15T12:10:00.000000Z',
      },
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
      {
        sensorId: 'bme280-sim-01',
        metric: 'temperature',
        value: 21.5,
        unit: 'C',
        observedAt: '2026-01-15T12:10:00.000000Z',
        receivedAt: null,
        delayS: null,
        quality: { status: null, confidence: null },
      },
    ],
    freshness: 'unknown',
    lastIngestAt: null,
    ageS: null,
    expectedIntervalS: null,
    staleAfterS: null,
    offlineAfterS: null,
  });
});

test('a collection that does not state a valid origin is not shown at all', () => {
  for (const origin of [undefined, null, '', 'LIVE', 'real', 'live ', {}]) {
    assert.equal(
      normalizeHubStations(collection([feature()], { origin })),
      null,
      String(origin),
    );
  }
});

test('anything that is not a feature collection is refused', () => {
  for (const value of [
    null,
    undefined,
    3,
    'x',
    [],
    {},
    { type: 'FeatureCollection' },
    { type: 'Feature' },
  ])
    assert.equal(normalizeHubStations(value), null);
});

test('stations without a usable id or position are dropped and counted', () => {
  const result = normalizeHubStations(
    collection(
      [
        feature({ id: '<img src=x onerror=alert(1)>' }),
        feature({ id: 'ok-1', geometry: null }),
        feature({
          id: 'ok-2',
          geometry: { type: 'Point', coordinates: [181, 0] },
        }),
        feature({
          id: 'ok-3',
          geometry: { type: 'Point', coordinates: [0, 91] },
        }),
        feature({
          id: 'ok-4',
          geometry: { type: 'Point', coordinates: ['1', '2'] },
        }),
        feature({
          id: 'ok-5',
          geometry: { type: 'Point', coordinates: [NaN, 2] },
        }),
        feature({ id: 'ok-6', geometry: { type: 'Polygon', coordinates: [] } }),
        feature({ id: 'good' }),
      ],
      { dropped_invalid: 2 },
    ),
  );
  assert.deepEqual(
    result.rows.map((r) => r.id),
    ['good'],
  );
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
            {
              sensor_id: 'bme280-sim-01',
              metric: hostile,
              value: 1,
              unit: hostile,
              observed_at: hostile,
            },
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
  assert.ok(
    r.metric.length <= 32 && r.unit.length <= 16 && r.observedAt === null,
  );
  assert.ok(
    !/[\u0000-\u001f‮]/.test(JSON.stringify(r).replace(/\\u[0-9a-f]{4}/gi, '')),
  );
  assert.ok(!('title' in row) && !('note' in row));
});

test('feature and reading counts are bounded', () => {
  const many = Array.from({ length: HUB_MAX_FEATURES + 50 }, (_, i) =>
    feature({ id: `s-${i}` }),
  );
  assert.equal(
    normalizeHubStations(collection(many)).rows.length,
    HUB_MAX_FEATURES,
  );
  const readings = Array.from({ length: 100 }, () => ({
    sensor_id: 'a',
    metric: 'm',
    value: 1,
  }));
  assert.equal(
    normalizeHubStations(collection([feature({ properties: { readings } })]))
      .rows[0].readings.length,
    32,
  );
});

test('cleanText flattens control characters and bidi overrides', () => {
  assert.equal(cleanText('a\nb‮c'), 'a b c');
  assert.equal(cleanText('   '), null);
  assert.equal(cleanText(5), null);
});

const TEST_LIMIT_MS = 10000;
const withFreshness = (props = {}, layer = {}) =>
  collection(
    [
      feature({
        properties: {
          location_precision_m: 11100,
          readings: [
            {
              sensor_id: 'bme280-sim-01',
              metric: 'temperature',
              value: 21.5,
              unit: 'C',
              observed_at: '2026-01-15T12:10:00.000000Z',
              received_at: '2026-01-15T12:12:30.000000Z',
              delay_s: 150,
              quality: { status: 'good', confidence: 0.95 },
            },
          ],
          freshness: 'fresh',
          last_ingest_at: '2030-05-01T10:00:00.000000Z',
          age_s: 12.5,
          expected_interval_s: 60,
          ...props,
        },
      }),
    ],
    {
      freshness: {
        status: 'fresh',
        last_ingest_at: '2030-05-01T10:00:00.000000Z',
        age_s: 12.5,
        expected_interval_s: 60,
        stale_after_s: 120,
        offline_after_s: 600,
        ...layer,
      },
    },
  );

test(
  'freshness, thresholds, received time, delay and quality are carried through',
  { timeout: TEST_LIMIT_MS },
  () => {
    const { rows, freshness } = normalizeHubStations(withFreshness());
    assert.equal(rows[0].freshness, 'fresh');
    assert.equal(rows[0].ageS, 12.5);
    assert.equal(rows[0].lastIngestAt, '2030-05-01T10:00:00.000000Z');
    assert.equal(rows[0].staleAfterS, 120);
    assert.equal(rows[0].offlineAfterS, 600);
    assert.deepEqual(rows[0].readings[0].quality, {
      status: 'good',
      confidence: 0.95,
    });
    assert.equal(rows[0].readings[0].delayS, 150);
    assert.equal(rows[0].readings[0].receivedAt, '2026-01-15T12:12:30.000000Z');
    assert.equal(freshness.status, 'fresh');
    assert.equal(freshness.staleAfterS, 120);
  },
);

test(
  'a payload without freshness (an older layers API) is unknown, never fresh',
  { timeout: TEST_LIMIT_MS },
  () => {
    const { rows, freshness } = normalizeHubStations(collection([feature()]));
    assert.equal(rows[0].freshness, 'unknown');
    assert.equal(rows[0].staleAfterS, null);
    assert.equal(freshness.status, 'unknown');
  },
);

test(
  'any unrecognised freshness word becomes unknown',
  { timeout: TEST_LIMIT_MS },
  () => {
    for (const word of [
      'FRESH',
      'fresh ',
      'fresh<script>',
      'current',
      'no_data',
      '',
      null,
      7,
      {},
      ['fresh'],
    ]) {
      const { rows, freshness } = normalizeHubStations(
        withFreshness({ freshness: word }, { status: word }),
      );
      assert.equal(rows[0].freshness, 'unknown', JSON.stringify(word));
      assert.equal(freshness.status, 'unknown', JSON.stringify(word));
    }
  },
);

test(
  'ages, intervals and thresholds outside sane bounds are dropped',
  { timeout: TEST_LIMIT_MS },
  () => {
    for (const bad of [-1, NaN, Infinity, 1e12, '12', null]) {
      assert.equal(
        normalizeHubStations(withFreshness({ age_s: bad })).rows[0].ageS,
        null,
        String(bad),
      );
    }
    for (const layer of [
      { stale_after_s: 600, offline_after_s: 120 },
      { stale_after_s: 120, offline_after_s: 120 },
      { stale_after_s: 0, offline_after_s: 120 },
      { stale_after_s: 'x', offline_after_s: 600 },
      { stale_after_s: 120, offline_after_s: undefined },
    ]) {
      const { rows } = normalizeHubStations(withFreshness({}, layer));
      assert.equal(rows[0].staleAfterS, null, JSON.stringify(layer));
      assert.equal(rows[0].offlineAfterS, null, JSON.stringify(layer));
    }
  },
);

test(
  'timestamps must be canonical UTC; anything else is null and markup is never kept',
  { timeout: TEST_LIMIT_MS },
  () => {
    for (const bad of [
      '<b>now</b>',
      '2030-05-01 10:00:00',
      '2030-05-01T10:00:00+02:00',
      12345,
      '',
    ]) {
      assert.equal(
        normalizeHubStations(withFreshness({ last_ingest_at: bad })).rows[0]
          .lastIngestAt,
        null,
        String(bad),
      );
    }
    const hostile = withFreshness();
    hostile.features[0].properties.readings[0].quality = {
      status: '<img onerror=x>\u0007good',
      confidence: 5,
    };
    const q = normalizeHubStations(hostile).rows[0].readings[0].quality;
    assert.equal(q.confidence, null);
    assert.ok(!/[\u0000-\u001f]/.test(q.status));
  },
);

test(
  'a repeated station id keeps the first station and counts the rest as dropped',
  { timeout: 10000 },
  () => {
    const result = normalizeHubStations(
      collection([
        feature({ id: 'a' }),
        feature({ id: 'b' }),
        feature({ id: 'b' }),
      ]),
    );
    assert.deepEqual(
      result.rows.map((r) => r.id),
      ['a', 'b'],
    );
    assert.equal(result.dropped, 1);
  },
);
