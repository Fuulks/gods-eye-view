import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HUB_NOT_CURRENT_AFTER_MS,
  classifyStation,
  clockOf,
  formatAge,
  hubIsCurrent,
  hubLayerText,
  stationLabel,
  stationVisual,
} from './freshness.js';

const TEST_LIMIT_MS = 10000;
const t = (name, fn) => test(name, { timeout: TEST_LIMIT_MS }, fn);
const row = (over = {}) => ({
  id: 'station-sim-01',
  origin: 'simulated',
  freshness: 'fresh',
  lastIngestAt: '2030-05-01T10:00:00.000000Z',
  ageS: 0,
  staleAfterS: 120,
  offlineAfterS: 600,
  ...over,
});
// monotonic times in ms; the answer arrived at 1000 and the last successful poll was that same moment
const at = (r, nowMs, extra = {}) =>
  classifyStation({
    row: r,
    receivedAtMs: 1000,
    nowMs,
    lastSuccessMs: 1000,
    ...extra,
  });

t('a fresh station with a recent poll is current and has no suffix', () => {
  const v = at(row(), 3000);
  assert.equal(v.state, 'fresh');
  assert.equal(v.current, true);
  assert.equal(v.suffix, '');
  assert.equal(stationLabel(row(), v), 'SIMULATED · station-sim-01');
});

t(
  'the age keeps growing between polls: fresh, then stale, then offline, with no new data',
  () => {
    const seen = (sec) =>
      at(row({ ageS: 10 }), 1000 + sec * 1000, {
        lastSuccessMs: 1000 + sec * 1000,
      });
    assert.equal(seen(100).state, 'fresh'); // 110 s <= 120 s
    assert.equal(seen(111).state, 'stale'); // 121 s
    assert.equal(seen(111).suffix, 'STALE 2 min');
    assert.equal(seen(591).state, 'offline'); // 601 s
    assert.match(seen(591).suffix, /^OFFLINE · last seen 10:00:00Z$/);
  },
);

t('the hub cannot make a station look better than its age says', () => {
  const lying = row({ freshness: 'fresh', ageS: 700 }); // says fresh, but 700 s old against a 600 s limit
  assert.equal(at(lying, 1000, { lastSuccessMs: 1000 }).state, 'offline');
  const worse = row({ freshness: 'offline', ageS: 1 }); // says offline: kept even though the age is small
  assert.equal(at(worse, 1000).state, 'offline');
});

t('thresholds come from the payload, not from the client', () => {
  const fast = row({ ageS: 8, staleAfterS: 10, offlineAfterS: 50 });
  assert.equal(at(fast, 1000).state, 'fresh');
  assert.equal(at(fast, 3500, { lastSuccessMs: 3500 }).state, 'stale'); // 10.5 s
  assert.equal(at(fast, 43500, { lastSuccessMs: 43500 }).state, 'offline'); // 50.5 s
});

t(
  'hub unreachable for more than 12 s marks even a fresh station NOT CURRENT, with its age',
  () => {
    const justOk = at(row(), 1000 + HUB_NOT_CURRENT_AFTER_MS);
    assert.equal(justOk.current, true);
    const down = at(row(), 1000 + HUB_NOT_CURRENT_AFTER_MS + 1);
    assert.equal(down.hubCurrent, false);
    assert.equal(down.state, 'stale');
    assert.equal(down.current, false);
    assert.match(down.suffix, /^NOT CURRENT · \d+ s$/);
    assert.equal(
      stationLabel(row(), down).startsWith(
        'SIMULATED · station-sim-01 · NOT CURRENT',
      ),
      true,
    );
  },
);

t(
  'a station keeps ageing while the hub is down and ends offline with its last-seen time',
  () => {
    const v = at(row({ ageS: 5 }), 1000 + 700 * 1000);
    assert.equal(v.state, 'offline');
    assert.equal(v.current, false);
    assert.match(v.suffix, /^OFFLINE · last seen 10:00:00Z$/);
  },
);

t('unknown inputs are never current', () => {
  const cases = [
    row({ freshness: 'unknown' }),
    row({ freshness: 'whatever' }),
    row({ ageS: null }),
    row({ staleAfterS: null }),
    row({ offlineAfterS: undefined }),
    null,
    undefined,
  ];
  for (const r of cases) {
    const v = at(r, 1500);
    assert.equal(v.state, 'unknown');
    assert.equal(v.current, false);
    assert.equal(v.suffix, 'NOT CURRENT');
  }
  const noReceipt = classifyStation({
    row: row(),
    receivedAtMs: null,
    nowMs: 1,
    lastSuccessMs: 1,
  });
  assert.equal(noReceipt.current, false);
  const neverPolled = classifyStation({
    row: row(),
    receivedAtMs: 1,
    nowMs: 2,
    lastSuccessMs: null,
  });
  assert.equal(neverPolled.current, false);
});

t('hubIsCurrent needs a poll within 12 s', () => {
  assert.equal(hubIsCurrent({ lastSuccessMs: null, nowMs: 5 }), false);
  assert.equal(hubIsCurrent({ lastSuccessMs: 0, nowMs: 12000 }), true);
  assert.equal(hubIsCurrent({ lastSuccessMs: 0, nowMs: 12001 }), false);
});

t('formatting is bounded and refuses nonsense', () => {
  assert.equal(formatAge(45), '45 s');
  assert.equal(formatAge(180), '3 min');
  assert.equal(formatAge(7200), '2 h');
  assert.equal(formatAge(3 * 86400), '3 d');
  for (const bad of [-1, NaN, Infinity, null, '5'])
    assert.equal(formatAge(bad), null);
  assert.equal(clockOf('2030-05-01T10:20:30.5Z'), '10:20:30Z');
  for (const bad of ['<b>', '2030-05-01 10:20:30', null, 5])
    assert.equal(clockOf(bad), null);
});

t(
  'layer text states the origin and the reason, with the last poll time when the hub is down',
  () => {
    assert.equal(
      hubLayerText({
        origin: 'simulated',
        states: ['fresh'],
        hubCurrent: true,
      }),
      'OneIntOS · SIMULATED',
    );
    assert.equal(
      hubLayerText({
        origin: 'simulated',
        states: ['fresh', 'stale'],
        hubCurrent: true,
      }),
      'OneIntOS · SIMULATED · STALE',
    );
    assert.equal(
      hubLayerText({
        origin: 'simulated',
        states: ['stale', 'offline'],
        hubCurrent: true,
      }),
      'OneIntOS · SIMULATED · OFFLINE',
    );
    assert.equal(
      hubLayerText({
        origin: 'simulated',
        states: ['fresh', 'unknown'],
        hubCurrent: true,
      }),
      'OneIntOS · SIMULATED · NOT CURRENT',
    );
    assert.equal(
      hubLayerText({
        origin: 'simulated',
        states: ['fresh'],
        hubCurrent: false,
        lastSuccessWallMs: Date.UTC(2030, 4, 1, 10, 20, 30),
      }),
      'OneIntOS · SIMULATED · NOT CURRENT · last poll 10:20:30Z',
    );
    assert.equal(
      hubLayerText({
        origin: null,
        states: [],
        hubCurrent: false,
        lastSuccessWallMs: null,
      }),
      'OneIntOS · NOT CURRENT · no data yet',
    );
  },
);

t(
  'visuals dim when stale, go grey when offline, and fresh keeps the origin colour',
  () => {
    const fresh = stationVisual('simulated', 'fresh');
    const stale = stationVisual('simulated', 'stale');
    const off = stationVisual('simulated', 'offline');
    assert.equal(fresh.pointAlpha, 1);
    assert.ok(stale.pointAlpha < 0.5 && stale.color !== fresh.color);
    assert.equal(off.color, '#7a7a7a');
    assert.deepEqual(stationVisual('simulated', 'unknown'), stale);
    for (const o of ['live', 'simulated', 'replayed'])
      assert.match(stationVisual(o, 'stale').color, /^#[0-9a-f]{6}$/);
  },
);
