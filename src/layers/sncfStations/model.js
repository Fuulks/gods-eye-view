/**
 * @module layers/sncfStations/model
 *
 * The French passenger-station network, normalized. Pure — no Cesium, no
 * network.
 *
 * WHAT THIS LAYER IS, PLAINLY: the SNCF Open Data catalogue's
 * `gares-de-voyageurs` dataset — 2 792 passenger stations with their
 * positions. It is the STATION NETWORK, not live train telemetry. The SNCF
 * catalogue publishes no live vehicle-position dataset (the datasets that
 * sound like one carry zero records, and the GTFS zip is a schedule), so
 * nothing here may be described as a live train position.
 */
// A portable export (package.json): no i18n here. The labels stay English
// data; the Layers panel shows them translated.
const msg = (text) => text;

export const SNCF_OVERLAY_SOURCE_ID = 'sncf-stations';
export const SNCF_OVERLAY_COHORT_LIMIT = 48;
export const SNCF_OVERLAY_COLLISION_CAPACITY = 32;

/** The dataset this layer draws, named so the row says where it came from. */
export const SNCF_DATASET = 'gares-de-voyageurs';

/**
 * The layer's own description of what it shows. The row shows this, so the
 * coverage and the nature of the data are stated rather than implied.
 */
export const SNCF_DESCRIPTION = msg(
  'French passenger stations (2 792 SNCF network) — station network, not live train positions',
);

/**
 * The colour a station is drawn in.
 *
 * The network segments (`segment_drg`) group the stations by rail
 * administration; each gets its own colour so the map reads as a network
 * rather than a scatter.
 */
export const SNCF_SEGMENT_COLORS = Object.freeze({
  A: '#4cc9f0',
  B: '#ffd43b',
  C: '#80ed99',
  D: '#ff6b35',
  E: '#a78bfa',
  F: '#f77f00',
});

/** The colour used for a segment the palette does not name. */
export const SNCF_UNKNOWN_COLOR = '#adb5bd';

/** Accent colour for a rail segment id. */
export function sncfSegmentColor(segment) {
  const key = String(segment ?? '')
    .trim()
    .toUpperCase();
  return SNCF_SEGMENT_COLORS[key] || SNCF_UNKNOWN_COLOR;
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
export function normalizeSncfStationPayload(payload) {
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
    const segment =
      String(raw?.segment ?? '')
        .trim()
        .toUpperCase() || null;
    stations.push({
      id,
      name: String(raw?.name ?? '').trim() || id,
      shortCode: String(raw?.shortCode ?? '').trim() || null,
      uic: String(raw?.uic ?? '').trim() || null,
      lon,
      lat,
      segment,
      color: sncfSegmentColor(segment),
    });
  }
  const total = Number(payload?.total);
  return {
    stations,
    total: Number.isFinite(total) && total >= 0 ? total : stations.length,
  };
}

/**
 * Map one station to a JSON-safe analyst record.
 * @param {object|null|undefined} raw
 * @param {number} [index=0]
 * @returns {object}
 */
export function mapSncfStationRecord(raw, index = 0) {
  const text = (value) => {
    const trimmed = String(value ?? '').trim();
    return trimmed || null;
  };
  const num = (value) => (Number.isFinite(value) ? value : null);
  return {
    id: text(raw?.id) || `SNCF-${String(index).padStart(4, '0')}`,
    name: text(raw?.name),
    shortCode: text(raw?.shortCode),
    uic: text(raw?.uic),
    segment: text(raw?.segment),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
  };
}

/**
 * Build the source-owned presentation for one station label.
 * @param {object} input
 * @returns {object}
 */
export function createSncfOverlayEntry({ id, position, title, accent }) {
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
export function selectSncfOverlayCohort(
  entries,
  limit = SNCF_OVERLAY_COHORT_LIMIT,
) {
  const cap = Math.max(
    0,
    Math.min(SNCF_OVERLAY_COHORT_LIMIT, Math.floor(Number(limit) || 0)),
  );
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .slice(0, cap);
}
