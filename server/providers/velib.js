/**
 * Vélib' Métropole proxy — the Paris docked-bikeshare network.
 *
 * Upstream: the operator's GBFS 2.x feed on
 * velib-metropole-opendata.smovengo.cloud.
 *
 * NO KEY. The GBFS feed is published under Licence Ouverte / Open License
 * and the browser never registers anything to read it.
 *
 * WHY A GBFS FEED AND NOT THE PARIS OPEN DATA CATALOGUE: the operator's own
 * GBFS feed is the authoritative live document — it carries the station
 * network AND the per-station availability in one specification, refreshed
 * every minute. The Paris Open Data catalogue mirrors the same numbers
 * through OpenDataSoft, but that mirror is a snapshot of a snapshot; the
 * GBFS feed is what the operator publishes for this purpose.
 *
 * WHY THE BROWSER NEVER NAMES AN UPSTREAM URL: the feed is served through
 * the local proxy, which resolves the two GBFS documents from its own
 * server-side allow-list, caps every read, caches them, and rate-limits
 * itself so a browser poll loop cannot hammer a public operator.
 *
 * The two documents are merged here, server-side: station_information.json
 * carries the network (ids, names, positions, capacity) and
 * station_status.json carries the live counts. The browser receives one
 * row per station, already joined.
 *
 * Routes (the browser names a route, never a URL):
 *   GET /api/velib/stations -> { fetchedAt, count, stations: [...] }
 */

import { createOpenDataService } from '../../src/sources/openDataProxy.js';
import { readResponseJsonCapped } from '../../src/sources/httpBody.js';

/** The operator's GBFS feed root. */
export const VELIB_FEED_BASE =
  'https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole';

/** The station network: ids, names, positions, capacity. */
export const VELIB_STATION_INFORMATION_URL =
  VELIB_FEED_BASE + '/station_information.json';

/** The live counts: bikes, e-bikes, free docks. */
export const VELIB_STATION_STATUS_URL =
  VELIB_FEED_BASE + '/station_status.json';

/** The operator refreshes the feed every minute; the feed's own TTL is 3600 s. */
export const VELIB_STATUS_TTL_MS = 60_000;

/** The station network changes on the order of days, not minutes. */
export const VELIB_NETWORK_TTL_MS = 6 * 3600_000;

/** station_information.json is about 280 kB as observed on 2026-10-27. */
export const VELIB_MAX_STATION_INFORMATION_BYTES = 2 * 1024 * 1024;

/** station_status.json is about 460 kB as observed on 2026-10-27. */
export const VELIB_MAX_STATION_STATUS_BYTES = 2 * 1024 * 1024;

/**
 * 1 519 stations as observed on 2026-10-27; allow headroom, refuse absurdness.
 */
export const VELIB_MAX_STATIONS = 5_000;

/**
 * Read one GBFS document, byte-capped.
 *
 * @param {typeof fetch} fetchImpl Injected fetch.
 * @param {string} url The upstream document URL.
 * @param {number} maxBytes The byte cap for this document.
 * @param {AbortSignal} [signal] Abort signal.
 * @returns {Promise<object>} The parsed document.
 */
export async function readVelibDocument(fetchImpl, url, maxBytes, signal) {
  signal?.throwIfAborted();
  const response = await fetchImpl(url, {
    signal,
    redirect: 'manual',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const error = new Error(`upstream HTTP ${response.status}`);
    error.upstreamStatus = response.status;
    throw error;
  }
  return readResponseJsonCapped(response, maxBytes, signal);
}

/**
 * Normalize one station_information record into a plain row.
 *
 * @param {object} raw A GBFS station object.
 * @param {number} index Record index (fallback id).
 * @returns {{id: string, code: string|null, name: string|null, lon: number,
 *   lat: number, capacity: number|null}|null} Null when unusable.
 */
export function normalizeVelibStation(raw, index = 0) {
  const lon = Number(raw?.lon);
  const lat = Number(raw?.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  const text = (value) => {
    const trimmed = String(value ?? '').trim();
    return trimmed || null;
  };
  const id =
    text(raw?.station_id) || text(raw?.stationCode) || `velib-${index + 1}`;
  const capacity = Number(raw?.capacity);
  return {
    id,
    code: text(raw?.stationCode),
    name: text(raw?.name),
    lon,
    lat,
    capacity: Number.isFinite(capacity) && capacity >= 0 ? capacity : null,
  };
}

/**
 * Normalize one station_status record into the live counters.
 *
 * @param {object} raw A GBFS station status object.
 * @returns {{bikes: number, eBikes: number, docks: number, installed: boolean,
 *   renting: boolean, returning: boolean}|null} Null when unusable.
 */
export function normalizeVelibStatus(raw) {
  const bikes = Number(raw?.num_bikes_available);
  if (!Number.isFinite(bikes) || bikes < 0) return null;
  const types = Array.isArray(raw?.num_bikes_available_types)
    ? raw.num_bikes_available_types
    : [];
  let eBikes = 0;
  for (const entry of types) {
    const value = Number(entry?.ebike);
    if (Number.isFinite(value) && value > 0) eBikes += value;
  }
  const docks = Number(raw?.num_docks_available);
  const flag = (value) => Number(value) === 1 || value === true;
  return {
    bikes,
    eBikes,
    docks: Number.isFinite(docks) && docks >= 0 ? docks : null,
    installed: flag(raw?.is_installed),
    renting: flag(raw?.is_renting),
    returning: flag(raw?.is_returning),
  };
}

/**
 * Join the two GBFS documents into one row per station.
 *
 * The status document is authoritative for the live counters; a station the
 * status document does not mention keeps its position and reports zero
 * bikes, because an absent status row means "no live report", not "no
 * station".
 *
 * @param {object} information The station_information document.
 * @param {object} status The station_status document.
 * @returns {{count: number, stations: object[]}}
 */
export function joinVelibFeeds(information, status) {
  const informationRows = Array.isArray(information?.data?.stations)
    ? information.data.stations
    : [];
  const statusRows = Array.isArray(status?.data?.stations)
    ? status.data.stations
    : [];
  const statusById = new Map();
  for (const row of statusRows) {
    const id = String(row?.station_id ?? '').trim();
    if (id) statusById.set(id, row);
  }
  const stations = [];
  const seen = new Set();
  informationRows.forEach((raw, index) => {
    const station = normalizeVelibStation(raw, index);
    if (!station) return;
    if (seen.has(station.id)) return;
    seen.add(station.id);
    const live = normalizeVelibStatus(statusById.get(station.id)) || {
      bikes: 0,
      eBikes: 0,
      docks: station.capacity,
      installed: false,
      renting: false,
      returning: false,
    };
    stations.push({ ...station, ...live });
  });
  return {
    count: stations.length,
    stations: stations.slice(0, VELIB_MAX_STATIONS),
  };
}

/**
 * Fetch both GBFS documents and join them.
 *
 * @param {typeof fetch} fetchImpl Injected fetch.
 * @param {AbortSignal} [signal] Abort signal.
 * @returns {Promise<{fetchedAt: number, count: number, stations: object[]}>}
 */
export async function loadVelibStations(fetchImpl, signal) {
  const [information, status] = await Promise.all([
    readVelibDocument(
      fetchImpl,
      VELIB_STATION_INFORMATION_URL,
      VELIB_MAX_STATION_INFORMATION_BYTES,
      signal,
    ),
    readVelibDocument(
      fetchImpl,
      VELIB_STATION_STATUS_URL,
      VELIB_MAX_STATION_STATUS_BYTES,
      signal,
    ),
  ]);
  const joined = joinVelibFeeds(information, status);
  return { fetchedAt: Date.now(), ...joined };
}

/**
 * Build the Vélib' open-data service.
 *
 * @param {{fetchImpl?: typeof fetch}} [options]
 * @returns {{handle: Function, close: Function}}
 */
export function createVelibService({ fetchImpl = fetch } = {}) {
  return createOpenDataService({
    id: 'velib',
    routes: new Map([['stations', 'unused']]),
    loader: async (route, fetchImplArg, signal) => {
      if (route !== 'stations') throw new Error(`unknown route ${route}`);
      return loadVelibStations(fetchImplArg, signal);
    },
    ttlMs: VELIB_STATUS_TTL_MS,
    maxBytes: 4_000_000,
    maxPerWindow: 6,
    globalMaxPerWindow: 20,
    timeoutMs: 30_000,
    fetchImpl,
  });
}

/**
 * Vite plugin wrapping the Vélib' proxy.
 *
 * @param {{fetchImpl?: typeof fetch}} [options]
 * @returns {import('vite').Plugin}
 */
export function velibProxy(options = {}) {
  const service = createVelibService(options);
  function install(server) {
    server.middlewares.use('/api/velib', async (req, res) => {
      const response = await service.handle({
        url: `http://localhost/api/velib${req.url || '/'}`,
        method: req.method,
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    });
    server.httpServer?.once('close', service.close);
  }
  return {
    name: 'velib-proxy',
    closeBundle: service.close,
    configureServer: install,
    configurePreviewServer: install,
  };
}
