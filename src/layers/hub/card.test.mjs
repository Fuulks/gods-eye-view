import test from 'node:test';
import assert from 'node:assert/strict';
import { stationCardModel } from './card.js';

const TIMEOUT = { timeout: 10000 };
const row = {
  id: 'st-1',
  origin: 'simulated',
  precisionM: 10000,
  freshness: 'fresh',
  lastIngestAt: '2026-11-01T10:00:00Z',
  ageS: 2,
  expectedIntervalS: 60,
  staleAfterS: 120,
  offlineAfterS: 600,
  readings: [
    {
      sensorId: 's1',
      metric: 'humidity',
      value: 40,
      unit: '%',
      observedAt: '2026-11-01T09:59:58Z',
      receivedAt: '2026-11-01T10:00:00Z',
      delayS: 2,
      quality: { status: 'ok', confidence: 0.5 },
    },
  ],
};
const base = {
  row,
  receivedAtMs: 0,
  nowMs: 1000,
  lastSuccessMs: 0,
};

test(
  'card states origin, status, ingest time with relative age, and the approximate position',
  TIMEOUT,
  () => {
    const m = stationCardModel(base);
    assert.equal(m.title, 'SIMULATED · st-1');
    assert.equal(m.status, 'FRESH');
    assert.equal(m.notCurrent, false);
    const text = m.lines.join('\n');
    assert.match(text, /Last ingest: 2026-11-01T10:00:00Z$/m);
    assert.match(text, /Position approximate \(±5000 m\)/);
    assert.deepEqual(m.sensors[0], [
      's1 · humidity: 40 % · ok 50%',
      'Observed: 2026-11-01T09:59:58Z',
      'Received: 2026-11-01T10:00:00Z',
      'Delay: 2 s',
    ]);
  },
);

test('card never says FRESH once the hub is not current', TIMEOUT, () => {
  const m = stationCardModel({ ...base, nowMs: 20000 });
  assert.equal(m.status, 'NOT CURRENT');
  assert.equal(m.notCurrent, true);
  assert.match(m.lines[0], /hub not reachable/);
});

test(
  'card shows unknown, not invented values, for a row without freshness',
  TIMEOUT,
  () => {
    const m = stationCardModel({
      ...base,
      row: {
        ...row,
        freshness: 'unknown',
        ageS: null,
        lastIngestAt: null,
        expectedIntervalS: null,
        readings: [],
      },
    });
    assert.equal(m.status, 'NOT CURRENT');
    const text = m.lines.join('\n');
    assert.match(text, /Age: unknown/);
    assert.match(text, /Last ingest: unknown/);
  },
);

test('card shows offline and stale as such', TIMEOUT, () => {
  const stale = stationCardModel({
    ...base,
    row: { ...row, ageS: 200, freshness: 'stale' },
  });
  assert.equal(stale.status, 'STALE');
  const off = stationCardModel({
    ...base,
    row: { ...row, ageS: 700, freshness: 'offline' },
  });
  assert.equal(off.status, 'OFFLINE (no data for 12 min)');
  assert.doesNotMatch(off.status, /down|dead|broken|device/i);
});

test('card labels follow the active locale', TIMEOUT, async () => {
  const { setLocale } = await import('../../i18n/index.js');
  try {
    setLocale('de');
    const m = stationCardModel(base);
    assert.match(m.lines.join('\n'), /Alter: /);
    assert.match(m.lines.join('\n'), /Letzte Aufnahme: /);
    assert.match(m.sensors[0][3], /^Verzögerung: /);
  } finally {
    setLocale('en');
  }
  assert.match(stationCardModel(base).lines.join('\n'), /Age: /);
});

test('card never derives times from the browser clock', TIMEOUT, () => {
  const m = stationCardModel({
    ...base,
    nowWallMs: Date.parse('2026-11-01T10:15:00Z'),
  });
  const text = [...m.lines, ...m.sensors.flat()].join('\n');
  assert.doesNotMatch(text, /ago/);
  assert.match(text, /Age: 3 s/);
});
