import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TRANSIT_STATIONS_OVERLAY_SOURCE_ID,
  normalizeTransitStationPayload,
  selectTransitStationOverlayCohort,
  transitStationSegmentColor,
} from './stationModel.js';

test('a proxy payload is normalized into station rows coloured by rail segment', () => {
  const normalized = normalizeTransitStationPayload({
    total: 3,
    stations: [
      {
        id: 'a',
        name: 'Paris Gare du Nord',
        shortCode: 'PV',
        uic: '87747006',
        lon: 2.3553,
        lat: 48.8809,
        segment: 'a',
      },
      {
        id: 'b',
        name: 'Lyon Part-Dieu',
        lon: 4.8557,
        lat: 45.7608,
        segment: 'C',
      },
      // No coordinates: one unusable station is not evidence the payload is
      // broken, so it is skipped rather than refusing the whole snapshot.
      { id: 'c', name: 'Nowhere' },
      // A duplicate id is skipped.
      { id: 'a', name: 'Duplicate', lon: 1, lat: 1 },
    ],
  });
  assert.equal(normalized.total, 3);
  assert.equal(normalized.stations.length, 2);
  const [first, second] = normalized.stations;
  assert.equal(first.name, 'Paris Gare du Nord');
  assert.equal(first.shortCode, 'PV');
  assert.equal(first.uic, '87747006');
  assert.equal(first.segment, 'A');
  assert.equal(first.color, transitStationSegmentColor('A'));
  assert.equal(second.segment, 'C');
});

test('a structurally broken payload is refused so the last good one is kept', () => {
  assert.equal(normalizeTransitStationPayload(null), null);
  assert.equal(normalizeTransitStationPayload({}), null);
  assert.equal(normalizeTransitStationPayload({ stations: {} }), null);
});

test('the label cohort is bounded and keeps a stable identity', () => {
  const entries = Array.from({ length: 100 }, (_, index) => ({
    id: `station-${String(index).padStart(3, '0')}`,
  }));
  const cohort = selectTransitStationOverlayCohort(entries);
  assert.equal(cohort.length, 48);
  assert.deepEqual(
    cohort.map((entry) => entry.id),
    cohort.map((entry) => entry.id).slice().sort(),
  );
  assert.equal(selectTransitStationOverlayCohort(entries, 0).length, 0);
  assert.equal(selectTransitStationOverlayCohort(null).length, 0);
});

test('the station overlay lives under the Transit row own source id', () => {
  assert.equal(TRANSIT_STATIONS_OVERLAY_SOURCE_ID, 'transit-stations');
});

