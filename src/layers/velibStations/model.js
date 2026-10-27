/**
 * @module layers/velibStations/model
 *
 * The Vélib' Métropole station network and its live availability,
 * normalized. Pure — no Cesium, no network.
 *
 * WHAT THIS LAYER IS, PLAINLY: the operator's GBFS 2.x feed for the Paris
 * docked-bikeshare system — 1 519 stations across Paris and the
 * surrounding communes, each with its position and its live bike, e-bike
 * and free-dock counts. It is the station network WITH live availability,
 * not a map of individual bikes: GBFS reports what is on the ground at each
 * station, never which bike is which.
 */
// A portable export (package.json): no i18n here. The labels stay English
// data; the Layers panel shows them translated.
const msg = (text) => text;

export const VELIB_OVERLAY_SOURCE_ID = 'velib-stations';
export const VELIB_OVERLAY_COHORT_LIMIT = 48;
export const VELIB_OVERLAY_COLLISION_CAPACITY = 32;

/**
 * The layer's own description of what it shows. The row shows this, so the
 * coverage and the nature of the data are stated rather than implied.
 */
export const VELIB_DESCRIPTION = msg(
  "Paris docked bike share (1 519 Vélib' stations) — live availability per station, not per bike",
);

/**
 * Availability bands, used to colour a station by how much is on the ground.
 *
 * The bands partition the station's CAPACITY into quarters, half-open on
 * the left, so a station always lands in exactly one band. A station with
 * no capacity published falls back to its bike count alone.
 */
export const VELIB_AVAILABILITY_BANDS = Object.freeze([
  Object.freeze({ id: 'empty', label: msg('Empty'), color: '#d62728' }),
  Object.freeze({ id: 'low', label: msg('Low'), color: '#ff7f0e' }),
  Object.freeze({ id: 'good', label: msg('Good'), color: '#2ca02c' }),
  Object.freeze({ id: 'plenty', label: msg('Plenty'), color: '#1f77b4' }),
]);

/** The colour used when a station cannot be banded. */
export const VELIB_UNKNOWN_COLOR = '#adb5bd';

/**
 * Band a station by how full it is.
 *
 * @param {number} bikes Bikes on the ground.
 * @param {number|null|undefined} capacity The station's capacity.
 * @returns {string} Band id.
 */
export function velibAvailabilityBand(bikes, capacity) {
  const value = Number(bikes);
  if (!Number.isFinite(value) || value < 0) return 'empty';
  const cap = Number(capacity);
  if (!Number.isFinite(cap) || cap <= 0) {
    // No published capacity: fall back to the raw count.
    if (value <= 0) return 'empty';
    if (value <= 2) return 'low';
    if (value <= 8) return 'good';
    return 'plenty';
  }
  const ratio = value / cap;
  if (ratio <= 0.05) return 'empty';
  if (ratio <= 0.25) return 'low';
  if (ratio <= 0.6) return 'good';
  return 'plenty';
}

/**
 * Colour for an availability band.
 *
 * @param {string|null|undefined} band Band id.
 * @returns {string} Hex colour.
 */
export function velibAvailabilityColor(band) {
  const found = VELIB_AVAILABILITY_BANDS.find(
    (entry) => entry.id === String(band ?? ''),
  );
  return found ? found.color : VELIB_UNKNOWN_COLOR;
}

/**
 * Validate a proxy payload into a list of station rows.
 *
 * Atomic: a structurally broken payload returns null so the caller keeps
 * its last good snapshot. A station missing coordinates is skipped, since
 * one unusable station is not evidence the payload is broken.
 *
 * @param {object} payload The proxy's JSON body.
 * @returns {{stations: Array<object>, total: number}|null} Null when
 *   malformed.
 */
export function normalizeVelibStationPayload(payload) {
  if (!Array.isArray(payload?.stations)) return null;
  const stations = [];
  const seen = new Set();
  for (const raw of payload.stations) {
    const id = String(raw?.id ?? '').trim();
    const lon = Number(raw?.lon);
    const lat = Number(raw?.lat);
    if (!id) continue;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const bikes = Math.max(0, Number(raw?.bikes) || 0);
    const eBikes = Math.max(0, Number(raw?.eBikes) || 0);
    const capacityRaw = Number(raw?.capacity);
    const capacity =
      Number.isFinite(capacityRaw) && capacityRaw >= 0 ? capacityRaw : null;
    const docksRaw = Number(raw?.docks);
    const band = velibAvailabilityBand(bikes, capacity);
    stations.push({
      id,
      code: String(raw?.code ?? '').trim() || null,
      name: String(raw?.name ?? '').trim() || id,
      lon,
      lat,
      capacity,
      bikes,
      eBikes,
      mechanical: Math.max(0, bikes - eBikes),
      docks: Number.isFinite(docksRaw) && docksRaw >= 0 ? docksRaw : null,
      installed: raw?.installed === true,
      renting: raw?.renting === true,
      returning: raw?.returning === true,
      band,
      color: velibAvailabilityColor(band),
    });
  }
  const total = Number(payload?.total ?? payload?.count);
  return {
    stations,
    total: Number.isFinite(total) && total >= 0 ? total : stations.length,
  };
}

/**
 * Map one station to a JSON-safe analyst record.
 *
 * @param {object|null|undefined} raw
 * @param {number} [index=0]
 * @returns {object}
 */
export function mapVelibStationRecord(raw, index = 0) {
  const text = (value) => {
    const trimmed = String(value ?? '').trim();
    return trimmed || null;
  };
  const num = (value) => (Number.isFinite(value) ? value : null);
  return {
    id: text(raw?.id) || `velib-${index + 1}`,
    name: text(raw?.name),
    code: text(raw?.code),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    bikes: num(raw?.bikes) ?? 0,
    eBikes: num(raw?.eBikes) ?? 0,
    mechanical: num(raw?.mechanical) ?? 0,
    docks: num(raw?.docks),
    capacity: num(raw?.capacity),
    band: text(raw?.band),
  };
}
/**
 * Build the source-owned presentation for one station label.
 * @param {object} input
 * @returns {object}
 */
export function createVelibOverlayEntry({ id, position, title, accent }) {
  return {
    id: String(id),
    position,
    variant: 'label',
    title,
    accent,
    priority: 0,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 14,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep a bounded cohort of labels, with stable identity as the tie-break. */
export function selectVelibOverlayCohort(
  entries,
  limit = VELIB_OVERLAY_COHORT_LIMIT,
) {
  const cap = Math.max(
    0,
    Math.min(VELIB_OVERLAY_COHORT_LIMIT, Math.floor(Number(limit) || 0)),
  );
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .slice(0, cap);
}
