import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sncfSegmentColor,
  normalizeSncfStationPayload,
  mapSncfStationRecord,
  selectSncfOverlayCohort,
} from './model.js';

test('a station payload is normalized into rows', () => {
  const result = normalizeSncfStationPayload({
    total: 2792,
    stations: [
      {
        id: 'a',
        name: 'Chateauroux',
        shortCode: 'CTX',
        uic: '87597005',
        segment: 'A',
        lon: 1.699536,
        lat: 46.809737,
      },
    ],
  });
  assert.equal(result.stations.length, 1);
  assert.equal(result.total, 2792);
  assert.equal(result.stations[0].name, 'Chateauroux');
  assert.equal(result.stations[0].segment, 'A');
  assert.equal(result.stations[0].color, '#4cc9f0');
});

test('a structurally broken payload is refused so the last good one is kept', () => {
  assert.equal(normalizeSncfStationPayload(null), null);
  assert.equal(normalizeSncfStationPayload({}), null);
  assert.equal(normalizeSncfStationPayload({ stations: 'nope' }), null);
});

test('a station without coordinates is skipped, not fatal', () => {
  const result = normalizeSncfStationPayload({
    stations: [{ id: 'a', name: 'Nowhere' }, { id: 'b', lon: 1, lat: 46 }],
  });
  assert.equal(result.stations.length, 1);
  assert.equal(result.stations[0].id, 'b');
});

test('an out-of-range coordinate is refused', () => {
  const result = normalizeSncfStationPayload({
    stations: [{ id: 'a', lon: 999, lat: 46 }],
  });
  assert.equal(result.stations.length, 0);
});

test('a duplicate station id is kept only once', () => {
  const result = normalizeSncfStationPayload({
    stations: [
    { id: 'a', lon: 1, lat: 46 },
    { id: 'a', lon: 2, lat: 47 },
  ],
  });
  assert.equal(result.stations.length, 1);
});

test('an unknown rail segment gets the neutral colour', () => {
  assert.equal(sncfSegmentColor('Z'), '#adb5bd');
  assert.equal(sncfSegmentColor(null), '#adb5bd');
  assert.equal(sncfSegmentColor('b'), '#ffd43b');
});

test('an analyst record carries only JSON-safe values', () => {
  const record = mapSncfStationRecord({
    id: 'a',
    name: 'Chateauroux',
    shortCode: 'CTX',
    uic: '87597005',
    segment: 'A',
    lat: 46.809737,
    lon: 1.699536,
  });
  assert.equal(record.id, 'a');
  assert.equal(record.name, 'Chateauroux');
  assert.equal(record.lat, 46.809737);
  assert.deepEqual(
    JSON.parse(JSON.stringify(record)),
    record,
    'the record must survive a JSON round trip',
  );
});

test('the overlay cohort is bounded and stably ordered', () => {
  const entries = Array.from({ length: 80 }, (_, index) => ({
    id: `station-${String(index).padStart(3, '0')}`,
    priority: 0,
  }));
  const cohort = selectSncfOverlayCohort(entries);
  assert.equal(cohort.length, 48);
  assert.equal(cohort[0].id, 'station-000');
});
