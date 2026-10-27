import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VELIB_AVAILABILITY_BANDS,
  mapVelibStationRecord,
  normalizeVelibStationPayload,
  velibAvailabilityBand,
  velibAvailabilityColor,
} from './model.js';

test('the availability bands partition the station capacity', () => {
  assert.equal(velibAvailabilityBand(0, 40), 'empty');
  assert.equal(velibAvailabilityBand(2, 40), 'empty');
  assert.equal(velibAvailabilityBand(3, 40), 'low');
  assert.equal(velibAvailabilityBand(10, 40), 'low');
  assert.equal(velibAvailabilityBand(11, 40), 'good');
  assert.equal(velibAvailabilityBand(24, 40), 'good');
  assert.equal(velibAvailabilityBand(25, 40), 'plenty');
  assert.equal(velibAvailabilityBand(40, 40), 'plenty');
});

test('a station with no published capacity falls back to the raw count', () => {
  assert.equal(velibAvailabilityBand(0, null), 'empty');
  assert.equal(velibAvailabilityBand(1, null), 'low');
  assert.equal(velibAvailabilityBand(5, null), 'good');
  assert.equal(velibAvailabilityBand(20, null), 'plenty');
});

test('every band has a colour and an unknown band is refused', () => {
  for (const band of VELIB_AVAILABILITY_BANDS) {
    assert.match(velibAvailabilityColor(band.id), /^#[0-9a-f]{6}$/i);
  }
  assert.equal(velibAvailabilityColor('nope'), '#adb5bd');
  assert.equal(velibAvailabilityColor(undefined), '#adb5bd');
});

test('a payload is normalized into station rows', () => {
  const normalized = normalizeVelibStationPayload({
    total: 2,
    stations: [
      {
        id: '213688169',
        code: '16107',
        name: 'Benjamin Godard - Victor Hugo',
        lon: 2.275725,
        lat: 48.865983,
        capacity: 35,
        bikes: 4,
        eBikes: 2,
        docks: 30,
        installed: true,
        renting: true,
        returning: true,
      },
    ],
  });
  assert.equal(normalized.stations.length, 1);
  const station = normalized.stations[0];
  assert.equal(station.id, '213688169');
  assert.equal(station.bikes, 4);
  assert.equal(station.eBikes, 2);
  assert.equal(station.mechanical, 2);
  assert.equal(station.docks, 30);
  assert.equal(station.band, 'low');
  assert.equal(station.color, '#ff7f0e');
  assert.equal(normalized.total, 2);
});

test('a malformed payload is refused rather than shown as an empty layer', () => {
  assert.equal(normalizeVelibStationPayload(null), null);
  assert.equal(normalizeVelibStationPayload({}), null);
  assert.equal(normalizeVelibStationPayload({ stations: 'no' }), null);
});

test('a station without coordinates is skipped, not fatal', () => {
  const normalized = normalizeVelibStationPayload({
    stations: [
      { id: 'a', lon: 2, lat: 48 },
      { id: 'b' },
      { id: 'c', lon: 999, lat: 48 },
    ],
  });
  assert.equal(normalized.stations.length, 1);
  assert.equal(normalized.stations[0].id, 'a');
});

test('a duplicated station id is kept once', () => {
  const normalized = normalizeVelibStationPayload({
    stations: [
      { id: 'a', lon: 2, lat: 48 },
      { id: 'a', lon: 3, lat: 49 },
    ],
  });
  assert.equal(normalized.stations.length, 1);
  assert.equal(normalized.stations[0].lon, 2);
});

test('the analyst record carries the counters as plain numbers', () => {
  const record = mapVelibStationRecord({
    id: 'a',
    name: 'Station',
    code: '16107',
    lon: 2.275725,
    lat: 48.865983,
    bikes: 4,
    eBikes: 2,
    mechanical: 2,
    docks: 30,
    capacity: 35,
    band: 'low',
  });
  assert.equal(record.id, 'a');
  assert.equal(record.bikes, 4);
  assert.equal(record.eBikes, 2);
  assert.equal(record.mechanical, 2);
  assert.equal(record.docks, 30);
  assert.equal(record.capacity, 35);
  assert.equal(record.band, 'low');
});
