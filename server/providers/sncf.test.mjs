import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSncfStation,
  normalizeSncfStationPage,
  loadSncfStations,
} from './sncf.js';

test('normalizeSncfStation reads the geo position', () => {
  const row = normalizeSncfStation({
    id: 'abc',
    nom: 'Châteauroux',
    libellecourt: 'CTX',
    codes_uic: '87597005',
    segment_drg: 'A',
    position_geographique: { lon: 1.699536, lat: 46.809737 },
  });
  assert.equal(row.id, 'abc');
  assert.equal(row.name, 'Châteauroux');
  assert.equal(row.shortCode, 'CTX');
  assert.equal(row.uic, '87597005');
  assert.equal(row.lon, 1.699536);
  assert.equal(row.lat, 46.809737);
});

test('normalizeSncfStation rejects a row without coordinates', () => {
  assert.equal(normalizeSncfStation({ nom: 'Nowhere' }), null);
  assert.equal(normalizeSncfStation({ position_geographique: {} }), null);
});

test('normalizeSncfStation rejects out-of-range coordinates', () => {
  assert.equal(
    normalizeSncfStation({ position_geographique: { lon: 999, lat: 10 } }),
    null,
  );
  assert.equal(
    normalizeSncfStation({ position_geographique: { lon: 10, lat: 999 } }),
    null,
  );
});

test('normalizeSncfStation falls back to the UIC code for an id', () => {
  const row = normalizeSncfStation({
    codes_uic: '87597005',
    position_geographique: { lon: 1.5, lat: 46.5 },
  });
  assert.equal(row.id, '87597005');
});

test('normalizeSncfStationPage reports the total and drops bad rows', () => {
  const page = normalizeSncfStationPage({
    total_count: 2,
    results: [
      { position_geographique: { lon: 1, lat: 46 } },
      { nom: 'broken' },
    ],
  });
  assert.equal(page.total, 2);
  assert.equal(page.rows.length, 1);
});

test('loadSncfStations pages the catalogue until the total is reached', async () => {
  // The upstream caps a page at 100 rows, so a full page is what keeps the
  // sweep going; the last page is the short one that ends it.
  const full = Array.from({ length: 100 }, (_, i) => ({
    position_geographique: { lon: 1 + i * 0.01, lat: 46 },
  }));
  const pages = [
    { total_count: 150, results: full },
    { total_count: 150, results: full.slice(0, 50) },
  ];
  let call = 0;
  const snapshot = await loadSncfStations(async () => {
    const body = pages[Math.min(call, pages.length - 1)];
    call += 1;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  assert.equal(call, 2, 'the sweep stops after the short final page');
  assert.equal(snapshot.count, 150);
  assert.equal(snapshot.total, 150);
  assert.ok(snapshot.fetchedAt > 0);
});

test('loadSncfStations stops on a short page', async () => {
  let call = 0;
  const snapshot = await loadSncfStations(async () => {
    call += 1;
    return new Response(
      JSON.stringify({
        total_count: 2,
        results: [
          { position_geographique: { lon: 1, lat: 46 } },
          { position_geographique: { lon: 2, lat: 47 } },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });
  assert.equal(call, 1);
  assert.equal(snapshot.count, 2);
});

test('loadSncfStations surfaces an upstream failure', async () => {
  await assert.rejects(
    loadSncfStations(async () => new Response('nope', { status: 500 })),
    /upstream HTTP 500/,
  );
});
