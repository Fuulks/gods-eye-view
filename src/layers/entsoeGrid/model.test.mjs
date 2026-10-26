import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENTSOE_KEY_ID,
  entsoeBandColor,
  entsoeLoadBand,
  normalizeEntsoePayload,
  mapEntsoeRecord,
} from './model.js';

test('a load is banded against the largest value in the same snapshot', () => {
  assert.equal(entsoeLoadBand(100, 100), 'peak');
  assert.equal(entsoeLoadBand(60, 100), 'high');
  assert.equal(entsoeLoadBand(30, 100), 'moderate');
  assert.equal(entsoeLoadBand(10, 100), 'low');
});

test('a load without a maximum falls back to the low band', () => {
  assert.equal(entsoeLoadBand(100, 0), 'low');
  assert.equal(entsoeLoadBand(Number.NaN, 100), 'low');
});

test('a band has a colour, and an unknown band falls back', () => {
  assert.equal(entsoeBandColor('peak'), '#d0271d');
  assert.equal(entsoeBandColor('nope'), '#3aa76d');
});

test('a payload is normalized into a banded series', () => {
  const result = normalizeEntsoePayload({
    unit: 'MW',
    day: '2026-10-25',
    points: [
      { position: 1, value: 100 },
      { position: 2, value: 25 },
    ],
  });
  assert.equal(result.series.length, 2);
  assert.equal(result.unit, 'MW');
  assert.equal(result.day, '2026-10-25');
  assert.equal(result.series[0].band, 'peak');
  assert.equal(result.series[1].band, 'low');
});

test('a structurally broken payload is refused so the last good one is kept', () => {
  assert.equal(normalizeEntsoePayload(null), null);
  assert.equal(normalizeEntsoePayload({ points: 'nope' }), null);
  assert.equal(normalizeEntsoePayload({ points: [] }), null);
});

test('a point with a non-numeric value is skipped, not fatal', () => {
  const result = normalizeEntsoePayload({
    points: [
      { position: 1, value: 10 },
      { position: 'x', value: 20 },
    ],
  });
  assert.equal(result.series.length, 1);
});

test('an analyst record carries only JSON-safe values', () => {
  const record = mapEntsoeRecord({
    value: 100,
    unit: 'MW',
    band: 'peak',
    position: 1,
  });
  assert.equal(record.id, 'GRID-0000');
  assert.equal(record.value, 100);
  assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
});

test('the layer names the key it needs through the registry id', () => {
  assert.equal(ENTSOE_KEY_ID, 'entsoe');
});
