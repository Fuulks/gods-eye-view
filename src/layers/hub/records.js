/**
 * Normalize an OneIntOS layers-API station collection into plain display
 * records. Everything in the payload is untrusted data: this module accepts
 * only what it recognizes, bounds every string, strips control characters and
 * never produces markup. Rendering code must use text nodes only.
 */

export const HUB_ORIGINS = Object.freeze(['live', 'simulated', 'replayed']);
export const HUB_MAX_FEATURES = 500;
export const HUB_MAX_READINGS = 32;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/** A short, single-line, control-free string, or null. */
export function cleanText(value, max = 64) {
  if (typeof value !== 'string') return null;
  const text = value.replace(CONTROL, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The only freshness words this client accepts; anything else is treated as `unknown`, never as fresh. */
export const FRESHNESS_STATUSES = Object.freeze([
  'fresh',
  'stale',
  'offline',
  'unknown',
]);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const TEN_YEARS_S = 10 * 366 * 86400;

function isoUtc(value) {
  return typeof value === 'string' && ISO_UTC.test(value) ? value : null;
}

function seconds(value, max = TEN_YEARS_S) {
  const n = finite(value);
  return n !== null && n >= 0 && n <= max ? n : null;
}

function freshnessStatus(value) {
  return FRESHNESS_STATUSES.includes(value) ? value : 'unknown';
}

/** Layer-level freshness block and thresholds from the collection; null fields when absent or inconsistent. */
function normalizeLayerFreshness(raw) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const stale = seconds(f.stale_after_s);
  const offline = seconds(f.offline_after_s);
  const thresholdsOk =
    stale !== null && offline !== null && stale > 0 && stale < offline;
  return {
    status: freshnessStatus(f.status),
    ageS: seconds(f.age_s),
    lastIngestAt: isoUtc(f.last_ingest_at),
    expectedIntervalS: seconds(f.expected_interval_s),
    staleAfterS: thresholdsOk ? stale : null,
    offlineAfterS: thresholdsOk ? offline : null,
  };
}

function normalizeQuality(raw) {
  if (!raw || typeof raw !== 'object')
    return { status: null, confidence: null };
  const confidence = finite(raw.confidence);
  return {
    status: cleanText(raw.status, 16),
    confidence:
      confidence !== null && confidence >= 0 && confidence <= 1
        ? confidence
        : null,
  };
}

function normalizeReading(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sensorId =
    typeof raw.sensor_id === 'string' && ID_PATTERN.test(raw.sensor_id)
      ? raw.sensor_id
      : null;
  const metric = cleanText(raw.metric, 32);
  const value = finite(raw.value);
  if (!sensorId || !metric || value === null) return null;
  return {
    sensorId,
    metric,
    value,
    unit: cleanText(raw.unit, 16),
    observedAt: isoUtc(raw.observed_at),
    receivedAt: isoUtc(raw.received_at),
    delayS: finite(raw.delay_s),
    quality: normalizeQuality(raw.quality),
  };
}

/**
 * @param {unknown} collection A layers-API `FeatureCollection`.
 * @returns {{origin: string, rows: Array<object>, dropped: number, freshness: object} | null} null when the payload is not a collection.
 */
export function normalizeHubStations(collection) {
  if (!collection || typeof collection !== 'object') return null;
  if (
    collection.type !== 'FeatureCollection' ||
    !Array.isArray(collection.features)
  )
    return null;
  const origin = HUB_ORIGINS.includes(collection.origin)
    ? collection.origin
    : null;
  if (!origin) return null; // a collection that does not say where its data comes from is not shown
  const layerFreshness = normalizeLayerFreshness(collection.freshness);
  const rows = [];
  let dropped = Number.isFinite(collection.dropped_invalid)
    ? Math.max(0, Math.floor(collection.dropped_invalid))
    : 0;
  for (const feature of collection.features.slice(0, HUB_MAX_FEATURES)) {
    const id =
      typeof feature?.id === 'string' && ID_PATTERN.test(feature.id)
        ? feature.id
        : null;
    const coords =
      feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
    const lon = Array.isArray(coords) ? finite(coords[0]) : null;
    const lat = Array.isArray(coords) ? finite(coords[1]) : null;
    if (
      !id ||
      lon === null ||
      lat === null ||
      Math.abs(lon) > 180 ||
      Math.abs(lat) > 90
    ) {
      dropped += 1; // includes stations with no configured position: nothing to draw
      continue;
    }
    const props =
      feature.properties && typeof feature.properties === 'object'
        ? feature.properties
        : {};
    const readings = (Array.isArray(props.readings) ? props.readings : [])
      .slice(0, HUB_MAX_READINGS)
      .map(normalizeReading)
      .filter(Boolean);
    const precision = finite(props.location_precision_m);
    rows.push({
      id,
      lon,
      lat,
      origin,
      precisionM: precision !== null && precision > 0 ? precision : null,
      readings,
      // Freshness is per station; a missing or unknown word means "not current".
      freshness: freshnessStatus(props.freshness),
      lastIngestAt: isoUtc(props.last_ingest_at),
      ageS: seconds(props.age_s),
      expectedIntervalS: seconds(props.expected_interval_s),
      staleAfterS: layerFreshness.staleAfterS,
      offlineAfterS: layerFreshness.offlineAfterS,
    });
  }
  return { origin, rows, dropped, freshness: layerFreshness };
}
