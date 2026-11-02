export const HUB_STATIONS_LAYER_ID = 'hub-stations';
export const HUB_STATIONS_OVERLAY_SOURCE_ID = 'hub-stations';
export const HUB_OVERLAY_COHORT_LIMIT = 96;

/** Visible, fixed labels for the three data origins. The origin is never implied, always stated. */
export const ORIGIN_LABELS = Object.freeze({
  live: 'LIVE',
  simulated: 'SIMULATED',
  replayed: 'REPLAYED',
});
const ORIGIN_COLORS = Object.freeze({
  live: '#3ddc84',
  simulated: '#ffb300',
  replayed: '#4fc3f7',
});

export const originLabel = (origin) => ORIGIN_LABELS[origin] ?? 'UNKNOWN';
export const originColor = (origin) => ORIGIN_COLORS[origin] ?? '#9e9e9e';

/** The layer panel's source text: it names OneIntOS and the data origin. */
export function hubSourceText(origin) {
  return origin ? `OneIntOS · ${originLabel(origin)}` : 'OneIntOS';
}

/**
 * One text label for one station, through the world-overlay host (the only
 * allowed way to draw world text). The title is plain text built from a
 * validated id and a fixed origin label; it is never markup.
 */
export function createHubOverlayEntry({ row, position }) {
  return {
    id: String(row.id),
    position,
    variant: 'label',
    title: `${originLabel(row.origin)} · ${row.id}`,
    accent: originColor(row.origin),
    priority: 1000,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** JSON-safe analyst record for one station; no Cesium types. */
export function mapAnalystRecord(row, view = null) {
  return {
    id: row.id,
    // How current the readings are, so an analyst never takes old data for current data.
    freshness: view?.state ?? 'unknown',
    current: view?.current === true,
    ageS: Number.isFinite(view?.ageS) ? Math.round(view.ageS) : null,
    lastIngestAt: row.lastIngestAt ?? null,
    origin: row.origin,
    lat: row.lat,
    lon: row.lon,
    locationApproximate: true,
    precisionM: row.precisionM,
    readings: row.readings.map((r) => ({
      sensorId: r.sensorId,
      metric: r.metric,
      value: r.value,
      unit: r.unit,
      observedAt: r.observedAt,
    })),
  };
}
