/**
 * @module layers/transit/stations
 * @description The French passenger-station network as the Transit layer draws
 * it: ground ellipses clamped to the terrain plus the overlay labels.
 *
 * WHY IT LIVES IN TRANSIT: the owner asked for the station network to be part
 * of the Transit row rather than a second row of its own, so the Layers panel
 * keeps one Transit row that draws the live GTFS-RT fleet AND the French rail
 * network's stations.
 *
 * The markers are ground ellipses, clamped to the terrain, as in the
 * earthquake layer: a per-frame axis re-tessellates the clamped ground
 * primitive every frame, so the axes are static.
 */
import * as Cesium from 'cesium';
import {
  TRANSIT_STATIONS_OVERLAY_COHORT_LIMIT,
  TRANSIT_STATIONS_OVERLAY_COLLISION_CAPACITY,
  TRANSIT_STATIONS_OVERLAY_SOURCE_ID,
  createTransitStationOverlayEntry,
  selectTransitStationOverlayCohort,
} from './stationModel.js';

export * from './stationModel.js';

/** Station markers are a point anchor, not an extent. */
export const STATION_MARKER_RADIUS_M = 4_000;

/**
 * The station network the Transit layer owns.
 *
 * It is a scene-level part like the fleet: one Cesium CustomDataSource of
 * ground ellipses plus the overlay labels, both released on destroy.
 *
 * @param {object} context
 * @returns {object}
 */
export function createStationNetwork({ state, services, parts, source }) {
  const { governorRequestRender } = services.render;

  /** Abort a station read that is still in flight. */
  function abortStations() {
    state._stationRequest?.abort();
    state._stationRequest = null;
  }

  /** Rebuild entities and overlay labels from the current stations. */
  function renderStations() {
    const dataSource = state._stationDataSource;
    if (!dataSource) return;
    dataSource.entities.removeAll();
    const overlayEntries = [];
    for (const station of state._stations) {
      const position = Cesium.Cartesian3.fromDegrees(station.lon, station.lat);
      const color = Cesium.Color.fromCssColorString(station.color);
      dataSource.entities.add(
        new Cesium.Entity({
          id: `sncf-station:${station.id}`,
          position,
          ellipse: {
            // Static axes, as in the earthquake layer: a per-frame axis
            // re-tessellates the clamped ground primitive every frame.
            semiMajorAxis: STATION_MARKER_RADIUS_M,
            semiMinorAxis: STATION_MARKER_RADIUS_M,
            material: new Cesium.ColorMaterialProperty(color.withAlpha(0.35)),
            outline: true,
            outlineColor: color.withAlpha(0.9),
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
          properties: {
            name: station.name,
            shortCode: station.shortCode,
            uic: station.uic,
            segment: station.segment,
            lat: station.lat,
            lon: station.lon,
          },
        }),
      );
      overlayEntries.push(
        createTransitStationOverlayEntry({
          id: station.id,
          position,
          title: station.name,
          accent: station.color,
        }),
      );
    }
    if (state._enabled) {
      state._overlayHost.setEntries(
        TRANSIT_STATIONS_OVERLAY_SOURCE_ID,
        selectTransitStationOverlayCohort(overlayEntries),
        {
          cohortLimit: TRANSIT_STATIONS_OVERLAY_COHORT_LIMIT,
          collisionCapacity: TRANSIT_STATIONS_OVERLAY_COLLISION_CAPACITY,
          moving: false,
        },
      );
    }
    governorRequestRender('transit-stations');
  }

  /**
   * Read the French passenger-station catalogue and draw it.
   *
   * The catalogue is STATIC, so this runs once per enable rather than on the
   * fleet's poll. It deliberately does NOT follow the fleet's altitude gate or
   * its camera-driven proximity polling: a static national rail network that
   * only appeared once the camera dropped into a live GTFS-RT coverage area
   * would read as broken from any wider view, and the read itself is one
   * small cached proxy response.
   *
   * @returns {Promise<boolean>} True when the catalogue was drawn.
   */
  async function loadStations() {
    if (!state._enabled || typeof source?.getStations !== 'function')
      return false;
    abortStations();
    const request = new AbortController();
    state._stationRequest = request;
    try {
      const snapshot = await source.getStations({ signal: request.signal });
      if (
        request.signal.aborted ||
        state._stationRequest !== request ||
        !state._enabled
      )
        return false;
      state._stations = snapshot.stations;
      state._stationTotal = snapshot.total;
      state._stationUpdatedAt = Date.now();
      state._stationError = null;
      renderStations();
      state._dataManager?.refreshLayerStats?.();
      return true;
    } catch (error) {
      if (request.signal.aborted || state._stationRequest !== request)
        return false;
      state._stationError = error?.message || 'Station network unavailable';
      console.warn(
        '[Data:Transit] Station network unavailable:',
        state._stationError,
      );
      state._dataManager?.refreshLayerStats?.();
      return false;
    } finally {
      if (state._stationRequest === request) state._stationRequest = null;
    }
  }

  return { renderStations, loadStations, abortStations };
}
