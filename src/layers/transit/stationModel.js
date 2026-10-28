/**
 * @module layers/transit/stationModel
 * @description The French passenger-station network, normalized. Pure — no
 * Cesium, no network.
 *
 * The SNCF Open Data catalogue `gares-de-voyageurs` dataset — 2 792 passenger
 * stations with their positions, coloured by the rail segment (`segment_drg`)
 * they belong to. It is the STATION NETWORK, not live train telemetry: the
 * SNCF catalogue publishes no live vehicle-position dataset (the datasets that
 * sound like one carry zero records, and the GTFS zip is a schedule), so
 * nothing here may be described as a live train position.
 *
 * A portable export (package.json): no i18n here. The labels stay English
 * data; the Layers panel shows them translated.
 */
const msg = (text) => text;

/**
 * The overlay source the station labels are published under. It is the
 * Transit's OWN id, not the removed standalone layer's, so the labels live in
 * the same overlay namespace the Transit row already owns.
 */
export const TRANSIT_STATIONS_OVERLAY_SOURCE_ID = 'transit-stations';

/** How many station labels are published at once. */
export const TRANSIT_STATIONS_OVERLAY_COHORT_LIMIT = 48;

/** How many labels may share the same collision slot. */
export const TRANSIT_STATIONS_OVERLAY_COLLISION_CAPACITY = 32;

/**
 * The colours the rail segments are drawn in. The network segments
 * (`segment_drg`) group the stations by rail administration; each gets its
 * own colour so the map reads as a network rather than a scatter.
 */
export const TRANSIT_STATION_SEGMENT_COLORS = Object.freeze({
  A: '#4cc9f0',
  B: '#ffd43b',
  C: '#80ed99',
  D: '#ff6b35',
  E: '#a78bfa',
  F: '#f77f00',
});

/** The colour used for a segment the palette does not name. */
export const TRANSIT_STATION_UNKNOWN_COLOR = '#adb5bd';

/**
 * The rail segments, in the order the legend shows them.
 *
 * The catalogue field is the SNCF network's own administrative grouping of
 * the passenger stations. The catalogue does NOT publish what each letter
 * means in so many words, so the legend names the segment by its CODE and
 * does not invent a service name for it: a legend that claimed a high-speed
 * service for a segment the operator never called one would be a claim the
 * data cannot support.
 *
 * The colours are the ones the map already draws the segments in, so the
 * legend and the map cannot drift apart.
 */
export const TRANSIT_STATION_SEGMENTS = Object.freeze([
  Object.freeze({
    id: 'A',
    label: msg('Segment A'),
    color: TRANSIT_STATION_SEGMENT_COLORS.A,
  }),
  Object.freeze({
    id: 'B',
    label: msg('Segment B'),
    color: TRANSIT_STATION_SEGMENT_COLORS.B,
  }),
  Object.freeze({
    id: 'C',
    label: msg('Segment C'),
    color: TRANSIT_STATION_SEGMENT_COLORS.C,
  }),
  Object.freeze({
    id: 'D',
    label: msg('Segment D'),
    color: TRANSIT_STATION_SEGMENT_COLORS.D,
  }),
  Object.freeze({
    id: 'E',
    label: msg('Segment E'),
    color: TRANSIT_STATION_SEGMENT_COLORS.E,
  }),
  Object.freeze({
    id: 'F',
    label: msg('Segment F'),
    color: TRANSIT_STATION_SEGMENT_COLORS.F,
  }),
]);

/**
 * The legend entries for the station network: one per segment actually
 * present, plus an entry for the segments the palette does not name.
 *
 * @param {Array<object>} stations The station rows currently drawn.
 * @returns {Array<{id: string, label: string, color: string, count: number}>}
 */
export function transitStationSegments(stations = []) {
  const counts = new Map();
  let unknown = 0;
  for (const station of stations) {
    const key = String(station?.segment ?? '')
      .trim()
      .toUpperCase();
    if (!key || !TRANSIT_STATION_SEGMENT_COLORS[key]) {
      unknown += 1;
      continue;
    }
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const entries = TRANSIT_STATION_SEGMENTS.filter((segment) =>
    counts.has(segment.id),
  ).map((segment) => ({ ...segment, count: counts.get(segment.id) }));
  if (unknown) {
    entries.push({
      id: 'other',
      label: msg('Other segments'),
      color: TRANSIT_STATION_UNKNOWN_COLOR,
      count: unknown,
    });
  }
  return entries;
}

/**
 * The Transit row's own description of what it shows. The row states the
 * coverage and the nature of the data, so the merged layer is not
 * mistaken for live train telemetry: the SNCF catalogue publishes none.
 */
export const TRANSIT_STATION_DESCRIPTION = msg(
  'Live transit vehicles and the French passenger-station network (2 792 SNCF stations) — the stations are a network, not live train positions',
);

/**
 * Accent colour for a rail segment id.
 *
 * @param {string|null|undefined} segment
 * @returns {string} Hex colour.
 */
export function transitStationSegmentColor(segment) {
  const key = String(segment ?? '')
    .trim()
    .toUpperCase();
  return TRANSIT_STATION_SEGMENT_COLORS[key] || TRANSIT_STATION_UNKNOWN_COLOR;
}

/**
 * Validate a proxy payload into a list of station rows.
 *
 * Atomic: a structurally broken payload returns null so the caller keeps its
 * last good snapshot. A station missing coordinates is skipped, since one
 * unusable station is not evidence the payload is broken.
 *
 * @param {object} payload The proxy's JSON body.
 * @returns {{stations: Array<object>, total: number}|null} Null when
 *   malformed.
 */
export function normalizeTransitStationPayload(payload) {
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
      color: transitStationSegmentColor(segment),
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
 *
 * @param {object|null|undefined} raw
 * @param {number} [index=0]
 * @returns {object}
 */
export function mapTransitStationRecord(raw, index = 0) {
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
 *
 * @param {object} input
 * @returns {object}
 */
export function createTransitStationOverlayEntry({
  id,
  position,
  title,
  accent,
}) {
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
export function selectTransitStationOverlayCohort(
  entries,
  limit = TRANSIT_STATIONS_OVERLAY_COHORT_LIMIT,
) {
  const cap = Math.max(
    0,
    Math.min(
      TRANSIT_STATIONS_OVERLAY_COHORT_LIMIT,
      Math.floor(Number(limit) || 0),
    ),
  );
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .slice(0, cap);
}
