import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VELIB_FEED_BASE,
  VELIB_MAX_STATIONS,
  VELIB_STATION_INFORMATION_URL,
  VELIB_STATION_STATUS_URL,
  createVelibService,
  joinVelibFeeds,
  loadVelibStations,
  normalizeVelibStation,
  normalizeVelibStatus,
} from './velib.js';

const jsonResponse = (payload, init = {}) =>
  new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });

const INFORMATION = {
  data: {
    stations: [
      {
        station_id: '213688169',
        stationCode: '16107',
        name: 'Benjamin Godard - Victor Hugo',
        lat: 48.865983,
        lon: 2.275725,
        capacity: 35,
      },
      {
        station_id: '213688170',
        stationCode: '32304',
        name: 'Charcot - Benfleet',
        lat: 48.87837,
        lon: 2.440524,
        capacity: 28,
      },
    ],
  },
};

const STATUS = {
  data: {
    stations: [
      {
        station_id: '213688169',
        num_bikes_available: 4,
        num_bikes_available_types: [{ mechanical: 2 }, { ebike: 2 }],
        num_docks_available: 30,
        is_installed: 1,
        is_renting: 1,
        is_returning: 1,
      },
      {
        station_id: '213688170',
        num_bikes_available: 13,
        num_bikes_available_types: [{ mechanical: 3 }, { ebike: 10 }],
        num_docks_available: 16,
        is_installed: 1,
        is_renting: 1,
        is_returning: 1,
      },
    ],
  },
};

test('the feed is the operator GBFS root and needs no key', () => {
  assert.equal(
    VELIB_FEED_BASE,
    'https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole',
  );
  assert.equal(
    VELIB_STATION_INFORMATION_URL,
    `${VELIB_FEED_BASE}/station_information.json`,
  );
  assert.equal(
    VELIB_STATION_STATUS_URL,
    `${VELIB_FEED_BASE}/station_status.json`,
  );
  assert.ok(!VELIB_STATION_INFORMATION_URL.includes('key'));
  assert.ok(!VELIB_STATION_STATUS_URL.includes('token'));
});

test('a station is normalized into a row', () => {
  const row = normalizeVelibStation(INFORMATION.data.stations[0]);
  assert.equal(row.id, '213688169');
  assert.equal(row.code, '16107');
  assert.equal(row.name, 'Benjamin Godard - Victor Hugo');
  assert.equal(row.lon, 2.275725);
  assert.equal(row.lat, 48.865983);
  assert.equal(row.capacity, 35);
});

test('a station without usable coordinates is refused', () => {
  assert.equal(normalizeVelibStation({ station_id: 'x' }), null);
  assert.equal(normalizeVelibStation({ station_id: 'x', lon: 999, lat: 10 }), null);
  assert.equal(normalizeVelibStation({ station_id: 'x', lon: 2, lat: 91 }), null);
});

test('the live counters are read, e-bikes included', () => {
  const status = normalizeVelibStatus(STATUS.data.stations[0]);
  assert.equal(status.bikes, 4);
  assert.equal(status.eBikes, 2);
  assert.equal(status.docks, 30);
  assert.equal(status.installed, true);
  assert.equal(status.renting, true);
  assert.equal(status.returning, true);
});

test('a status row without a bike count is refused', () => {
  assert.equal(normalizeVelibStatus({ station_id: 'x' }), null);
  assert.equal(normalizeVelibStatus({ num_bikes_available: -1 }), null);
});

test('the two GBFS documents join into one row per station', () => {
  const joined = joinVelibFeeds(INFORMATION, STATUS);
  assert.equal(joined.count, 2);
  assert.equal(joined.stations[0].bikes, 4);
  assert.equal(joined.stations[0].eBikes, 2);
  assert.equal(joined.stations[0].lon, 2.275725);
  assert.equal(joined.stations[1].bikes, 13);
});

test('a station the status document does not mention keeps its position', () => {
  const joined = joinVelibFeeds(INFORMATION, { data: { stations: [] } });
  assert.equal(joined.count, 2);
  assert.equal(joined.stations[0].bikes, 0);
  assert.equal(joined.stations[0].installed, false);
  assert.equal(joined.stations[0].lon, 2.275725);
});

test('the join refuses duplicate station ids', () => {
  const joined = joinVelibFeeds(
    {
      data: {
        stations: [
          { station_id: 'a', lon: 2, lat: 48 },
          { station_id: 'a', lon: 3, lat: 49 },
        ],
      },
    },
    { data: { stations: [] } },
  );
  assert.equal(joined.count, 1);
});

test('the join caps the station count', () => {
  const stations = Array.from({ length: VELIB_MAX_STATIONS + 50 }, (_, index) => ({
    station_id: `s${index}`,
    lon: 2,
    lat: 48,
  }));
  const joined = joinVelibFeeds(
    { data: { stations } },
    { data: { stations: [] } },
  );
  assert.equal(joined.stations.length, VELIB_MAX_STATIONS);
});

test('the loader reads both GBFS documents from the operator', async () => {
  const seen = [];
  const result = await loadVelibStations(async (url) => {
    seen.push(String(url));
    if (String(url).endsWith('station_information.json')) {
      return jsonResponse(INFORMATION);
    }
    return jsonResponse(STATUS);
  });
  assert.equal(seen.length, 2);
  assert.ok(seen.includes(VELIB_STATION_INFORMATION_URL));
  assert.ok(seen.includes(VELIB_STATION_STATUS_URL));
  assert.equal(result.count, 2);
  assert.equal(result.stations[0].bikes, 4);
  assert.ok(Number.isFinite(result.fetchedAt));
});

test('an upstream failure is surfaced with its status', async () => {
  await assert.rejects(
    loadVelibStations(async () => jsonResponse({}, { status: 503 })),
    /upstream HTTP 503/,
  );
});

test('the proxy answers the stations route with the joined snapshot', async () => {
  const service = createVelibService({
    fetchImpl: async (url) =>
      String(url).endsWith('station_information.json')
        ? jsonResponse(INFORMATION)
        : jsonResponse(STATUS),
  });
  const response = await service.handle({
    url: 'http://localhost/api/velib/stations',
    method: 'GET',
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.count, 2);
  assert.equal(body.stations[0].bikes, 4);
  service.close();
});

test('the proxy refuses a non-GET request', async () => {
  const service = createVelibService({
    fetchImpl: async () => {
      throw new Error('the upstream must not be contacted');
    },
  });
  const response = await service.handle({
    url: 'http://localhost/api/velib/stations',
    method: 'POST',
  });
  assert.equal(response.status, 405);
  service.close();
});

test('the browser never names an upstream URL: the proxy resolves it', async () => {
  const seen = [];
  const service = createVelibService({
    fetchImpl: async (url) => {
      seen.push(String(url));
      return jsonResponse(INFORMATION);
    },
  });
  await service.handle({
    url: 'http://localhost/api/velib/stations',
    method: 'GET',
  });
  assert.ok(seen.length > 0);
  for (const url of seen) {
    assert.ok(url.startsWith(VELIB_FEED_BASE));
    assert.ok(!url.includes('/api/velib'));
  }
  service.close();
});
