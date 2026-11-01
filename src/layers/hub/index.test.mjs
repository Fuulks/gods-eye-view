import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createHubStationsLayer } from './index.js';
import { claimPointer, releasePointer } from '../../data/inputOwnership.js';

const TIMEOUT = { timeout: 10000 };

function row(over = {}) {
  return {
    id: 'st-1',
    origin: 'live',
    lat: 0,
    lon: 0,
    precisionM: 10000,
    freshness: 'fresh',
    lastIngestAt: '2026-11-01T10:00:00Z',
    ageS: 1,
    expectedIntervalS: 60,
    staleAfterS: 120,
    offlineAfterS: 600,
    readings: [
      {
        sensorId: 's1',
        metric: 'temperature',
        value: 21.5,
        unit: 'C',
        observedAt: '2026-11-01T10:00:00Z',
        receivedAt: '2026-11-01T10:00:00Z',
        delayS: 0,
        quality: { status: 'ok', confidence: 0.9 },
      },
    ],
    ...over,
  };
}

function fakeEl(tag) {
  const el = {
    tag,
    children: [],
    style: {},
    attrs: {},
    textContent: '',
    appendChild(c) {
      el.children.push(c);
      c.parent = el;
    },
    replaceChildren() {
      el.children = [];
    },
    setAttribute(k, v) {
      el.attrs[k] = v;
    },
    remove() {
      if (el.parent)
        el.parent.children = el.parent.children.filter((c) => c !== el);
    },
  };
  return el;
}
const texts = (el) => [el.textContent, ...el.children.flatMap(texts)];

function harness({ rows = [row()], origin = 'live' } = {}) {
  const t = { mono: 1000, wall: Date.parse('2026-11-01T10:00:05Z') };
  const state = { fail: false, rows, origin };
  const calls = {
    entries: [],
    timers: [],
    cleared: [],
    owners: [],
    unowned: [],
  };
  const source = {
    async getStations() {
      if (state.fail) throw new Error('hub down');
      return { origin: state.origin, rows: state.rows };
    },
  };
  const overlayHost = {
    setVisible() {},
    clearSource() {},
    setEntries(_id, entries) {
      calls.entries.push(entries);
    },
  };
  let click = null;
  const handler = {
    setInputAction(fn) {
      click = fn;
    },
    destroy() {
      calls.destroyed = true;
    },
  };
  let picked = null;
  const picking = {
    registerPickOwner: (id, fn) => calls.owners.push([id, fn]),
    unregisterPickOwner: (id) => calls.unowned.push(id),
    resolvePickId: () => picked,
  };
  const body = fakeEl('body');
  const doc = { body, createElement: fakeEl };
  const viewer = {
    dataSources: {
      add(ds) {
        calls.ds = ds;
      },
      remove() {},
    },
    scene: { canvas: {}, pick: () => ({}) },
  };
  const layer = createHubStationsLayer({
    source,
    overlayHost,
    picking,
    now: () => t.mono,
    wallNow: () => t.wall,
    setTimer: (fn, ms) => {
      calls.timers.push({ fn, ms });
      return calls.timers.length;
    },
    clearTimer: (h) => calls.cleared.push(h),
    createInputHandler: () => handler,
    doc,
  });
  layer.init(viewer);
  layer.enable();
  return {
    layer,
    t,
    state,
    calls,
    body,
    pick: (id) => {
      picked = id;
    },
    click: () => click({ position: { x: 1, y: 1 } }),
    label: () => calls.entries.at(-1)[0].title,
    advance(ms) {
      t.mono += ms;
      t.wall += ms;
      calls.timers.at(-1).fn();
    },
  };
}

test(
  'fresh stations are labelled with origin and id only, layer text is plain',
  TIMEOUT,
  async () => {
    const h = harness();
    assert.equal(await h.layer.update(), true);
    assert.equal(h.label(), 'LIVE · st-1');
    assert.equal(h.layer.source, 'OneIntOS · LIVE');
  },
);

test(
  'layers API stopped → GEV marks the layer not current after 12 s without a poll',
  TIMEOUT,
  async () => {
    const h = harness();
    await h.layer.update();
    h.state.fail = true;
    h.advance(5000);
    assert.equal(await h.layer.update(), false);
    assert.equal(h.layer.source, 'OneIntOS · LIVE', 'still within 12 s');
    h.advance(5000);
    await h.layer.update();
    assert.doesNotMatch(h.layer.source, /NOT CURRENT/, 'still within 12 s');
    h.advance(3000); // 13 s since the last good poll
    await h.layer.update();
    assert.match(h.layer.source, /NOT CURRENT · last poll 10:00:05Z/);
    assert.match(h.label(), /^LIVE · st-1 · NOT CURRENT/);
    assert.doesNotMatch(h.label(), /^LIVE · st-1$/, 'never looks current');
  },
);

test(
  'the layer keeps polling interval 5 s and keeps last stations when the hub is down',
  TIMEOUT,
  async () => {
    const h = harness();
    assert.equal(h.layer.updateInterval, 5000);
    await h.layer.update();
    h.state.fail = true;
    await h.layer.update();
    assert.equal(h.layer.getStats().count, 1);
    assert.match(h.layer.getStats().error, /hub down/);
    assert.equal(h.layer.getAnalystRecords().length, 1);
  },
);

test('a recovered poll makes the layer current again', TIMEOUT, async () => {
  const h = harness();
  await h.layer.update();
  h.state.fail = true;
  h.advance(13000);
  await h.layer.update();
  assert.match(h.layer.source, /NOT CURRENT/);
  h.state.fail = false;
  await h.layer.update();
  assert.equal(h.layer.source, 'OneIntOS · LIVE');
  assert.equal(h.label(), 'LIVE · st-1');
});

test(
  'Station API stopped → stale then offline, as the hub keeps answering with a growing age',
  TIMEOUT,
  async () => {
    const h = harness();
    await h.layer.update();
    let elapsed = 0;
    const poll = async (s) => {
      elapsed += s;
      h.advance(s * 1000);
      const age = 1 + elapsed;
      h.state.rows = [
        row({
          ageS: age,
          freshness: age <= 120 ? 'fresh' : age <= 600 ? 'stale' : 'offline',
        }),
      ];
      await h.layer.update();
    };
    await poll(60);
    assert.equal(h.label(), 'LIVE · st-1');
    await poll(65);
    assert.match(h.label(), /^LIVE · st-1 · STALE/);
    assert.match(h.layer.source, /STALE/);
    await poll(600);
    assert.match(h.label(), /OFFLINE \(no data for \d+ min\)/);
    assert.match(h.layer.source, /OFFLINE \(no recent data\)/);
  },
);

test('a hub that says stale cannot be shown as fresh', TIMEOUT, async () => {
  const h = harness({ rows: [row({ freshness: 'stale', ageS: 200 })] });
  await h.layer.update();
  assert.match(h.label(), /STALE/);
});

test(
  'an older API payload without freshness is NOT CURRENT, never fresh',
  TIMEOUT,
  async () => {
    const h = harness({ rows: [row({ freshness: 'unknown', ageS: null })] });
    await h.layer.update();
    assert.match(h.label(), /NOT CURRENT/);
    assert.match(h.layer.source, /NOT CURRENT/);
  },
);

test('the relabel tick runs only while enabled', TIMEOUT, async () => {
  const h = harness();
  assert.equal(h.calls.timers.length, 1);
  assert.equal(h.calls.timers[0].ms, 1000);
  h.layer.disable();
  assert.deepEqual(h.calls.cleared, [1]);
  h.layer.enable();
  assert.equal(h.calls.timers.length, 2);
  h.layer.destroy();
  assert.deepEqual(h.calls.cleared, [1, 2]);
  assert.deepEqual(h.calls.unowned, ['hub-stations']);
});

test(
  'clicking a station opens the card as text-only DOM, clicking elsewhere closes it',
  TIMEOUT,
  async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const h = harness({
      rows: [
        row({
          readings: [
            { ...row().readings[0], sensorId: hostile, metric: 'temperature' },
          ],
        }),
      ],
    });
    await h.layer.update();
    h.pick('hub-station:st-1');
    h.click();
    assert.equal(h.body.children.length, 1);
    const all = texts(h.body.children[0]).join('\n');
    assert.match(all, /LIVE · st-1/);
    assert.match(all, /FRESH/);
    assert.match(all, /Position approximate/);
    assert.ok(all.includes(hostile), 'hostile text is shown as text');
    h.pick(null);
    h.click();
    assert.equal(h.body.children.length, 0);
  },
);

test(
  'the open card shows NOT CURRENT when the hub goes away',
  TIMEOUT,
  async () => {
    const h = harness();
    await h.layer.update();
    h.pick('hub-station:st-1');
    h.click();
    h.state.fail = true;
    h.advance(13000);
    const all = texts(h.body.children[0]).join('\n');
    assert.match(all, /NOT CURRENT/);
    assert.doesNotMatch(all, /Freshness: FRESH/);
  },
);

test(
  'clicks are ignored while another tool owns the pointer or the layer is disabled',
  TIMEOUT,
  async () => {
    const h = harness();
    await h.layer.update();
    h.layer.disable();
    h.pick('hub-station:st-1');
    h.click();
    assert.equal(h.body.children.length, 0);
  },
);

test('the pick owner claims only hub station ids', TIMEOUT, () => {
  const h = harness();
  const [id, owns] = h.calls.owners[0];
  assert.equal(id, 'hub-stations');
  assert.equal(owns('hub-station:x'), true);
  assert.equal(owns('flight:1'), false);
});

test(
  'point opacity dims when stale and greys when offline',
  TIMEOUT,
  async () => {
    const h = harness();
    await h.layer.update();
    const entity = () => h.calls.ds.entities.getById('hub-station:st-1');
    const alpha = () => entity().point.color.getValue().alpha;
    assert.equal(alpha(), 1);
    h.advance(130000);
    assert.ok(alpha() < 1, 'stale is dimmed');
    h.advance(700000);
    assert.ok(alpha() < 0.7, 'offline is more transparent than fresh');
  },
);

test(
  'a poll with repeated ids cannot leave the map out of step with the rows',
  TIMEOUT,
  async () => {
    const h = harness();
    await h.layer.update();
    h.state.rows = [row({ id: 'b' }), row({ id: 'c' }), row({ id: 'c' })];
    assert.equal(await h.layer.update(), true, 'the poll succeeds');
    assert.equal(h.layer.getStats().error, null);
    assert.equal(h.layer.getStats().count, 2);
    assert.deepEqual(
      h.layer.getAnalystRecords().map((r) => r.id),
      ['b', 'c'],
    );
    const ids = h.calls.ds.entities.values.map((e) => e.id).sort();
    assert.deepEqual(ids, ['hub-station:b', 'hub-station:c']);
    assert.equal(
      h.calls.entries.at(-1).length,
      2,
      'every drawn station is labelled',
    );
  },
);

test(
  're-enabling after a pause relabels at once and never shows old data as current',
  TIMEOUT,
  async () => {
    const h = harness();
    await h.layer.update();
    h.layer.disable();
    h.t.mono += 30000;
    h.t.wall += 30000;
    h.layer.enable();
    assert.match(h.layer.source, /NOT CURRENT/);
    assert.match(h.label(), /^LIVE · st-1 · NOT CURRENT/);
    assert.ok(
      h.calls.ds.entities.getById('hub-station:st-1').point.color.getValue()
        .alpha < 1,
    );
  },
);

test(
  'analyst records say how current each station is and never claim current when the hub is gone',
  TIMEOUT,
  async () => {
    const h = harness();
    await h.layer.update();
    let [rec] = h.layer.getAnalystRecords();
    assert.equal(rec.freshness, 'fresh');
    assert.equal(rec.current, true);
    assert.equal(rec.lastIngestAt, '2026-11-01T10:00:00Z');
    h.state.fail = true;
    h.advance(13000);
    await h.layer.update();
    [rec] = h.layer.getAnalystRecords();
    assert.equal(rec.current, false);
    assert.notEqual(rec.freshness, 'fresh');
    assert.ok(rec.ageS >= 13);
  },
);

test(
  'analyst records for an older payload without freshness are unknown, not current',
  TIMEOUT,
  async () => {
    const h = harness({ rows: [row({ freshness: 'unknown', ageS: null })] });
    await h.layer.update();
    const [rec] = h.layer.getAnalystRecords();
    assert.equal(rec.freshness, 'unknown');
    assert.equal(rec.current, false);
  },
);

test(
  'a hub-reported stale or offline status wins over a small age',
  TIMEOUT,
  async () => {
    for (const [freshness, label] of [
      ['stale', /STALE/],
      ['offline', /OFFLINE/],
    ]) {
      const h = harness({ rows: [row({ freshness, ageS: 5 })] });
      await h.layer.update();
      assert.match(h.label(), label, freshness);
      const [rec] = h.layer.getAnalystRecords();
      assert.equal(rec.freshness, freshness);
      assert.equal(rec.current, false);
    }
  },
);
