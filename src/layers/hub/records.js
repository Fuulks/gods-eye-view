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
    observedAt: cleanText(raw.observed_at, 40),
  };
}

/**
 * @param {unknown} collection A layers-API `FeatureCollection`.
 * @returns {{origin: string, rows: Array<object>, dropped: number} | null} null when the payload is not a collection.
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
    });
  }
  return { origin, rows, dropped };
}
