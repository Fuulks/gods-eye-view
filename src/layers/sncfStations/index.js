import * as Cesium from 'cesium';
import { msg, t, tn } from '../../i18n/index.js';
import { translateFeedError } from '../../ui/statusText.js';
import {
  SNCF_DESCRIPTION,
  SNCF_OVERLAY_COLLISION_CAPACITY,
  SNCF_OVERLAY_COHORT_LIMIT,
  SNCF_OVERLAY_SOURCE_ID,
  createSncfOverlayEntry,
  mapSncfStationRecord,
  selectSncfOverlayCohort,
} from './model.js';
export * from './model.js';
export { createSncfStationsSource } from './source.js';

/** Station markers are a point anchor, not an extent. */
const STATION_MARKER_RADIUS_M = 4_000;

/**
 * Own one passenger-station display: the French rail network as a set of
 * selectable ground anchors.
 *
 * This is the STATION NETWORK, not live train telemetry — the SNCF catalogue
 * publishes no live vehicle positions, and the layer says so in its row.
 */
export function createSncfStationsLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('SNCF stations require a snapshot source');
  if (!overlayHost)
    throw new TypeError('SNCF stations require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _stations = [];
  let _total = 0;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let rowControlsListener = null;

  const notify = () => rowControlsListener?.();

  const layer = {
    id: 'sncf-stations',
    name: 'SNCF Stations',
    icon: '🚉',
    source: 'SNCF Open Data',
    updateInterval: 6 * 3600_000,

    init(viewer) {
      if (_viewer)
        throw new Error('SNCF stations layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('sncf-stations');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _stations = [];
      _total = 0;
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(SNCF_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(SNCF_OVERLAY_SOURCE_ID, true);
      notify();
    },

    disable() {
      // Abort in flight: a response arriving after disable must not redraw.
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(SNCF_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SNCF_OVERLAY_SOURCE_ID, false);
      notify();
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _stations = snapshot.stations;
        _total = snapshot.total;
        this._render();
        _count = _stations.length;
        _lastUpdate = Date.now();
        _lastError = null;
        notify();
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request) return false;
        _lastError = error?.message || msg('Station network unavailable');
        console.warn('[Data:SNCFStations] Refresh failed:', _lastError);
        notify();
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    /** Rebuild entities and overlay labels from the current stations. */
    _render() {
      if (!_dataSource) return;
      _dataSource.entities.removeAll();
      const overlayEntries = [];
      for (const station of _stations) {
        const position = Cesium.Cartesian3.fromDegrees(
          station.lon,
          station.lat,
        );
        const color = Cesium.Color.fromCssColorString(station.color);
        _dataSource.entities.add(
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
          createSncfOverlayEntry({
            id: station.id,
            position,
            title: station.name,
            accent: station.color,
          }),
        );
      }
      if (_enabled) {
        overlayHost.setEntries(
          SNCF_OVERLAY_SOURCE_ID,
          selectSncfOverlayCohort(overlayEntries),
          {
            cohortLimit: SNCF_OVERLAY_COHORT_LIMIT,
            collisionCapacity: SNCF_OVERLAY_COLLISION_CAPACITY,
            moving: false,
          },
        );
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      overlayHost.clearSource(SNCF_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SNCF_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer?.dataSources?.remove(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _stations = [];
      _total = 0;
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      rowControlsListener = null;
    },

    /**
     * Readout descriptor for the Layers panel. The description states what
     * the layer IS: the station network, not live train positions.
     */
    getRowControls() {
      return {
        readout: true,
        summary: {
          label: t('SNCF Stations'),
          coverage: t(SNCF_DESCRIPTION),
          validTime: _lastUpdate
            ? new Date(_lastUpdate).toISOString()
            : undefined,
          status: _lastError
            ? translateFeedError(_lastError)
            : _count === 0
              ? _lastUpdate === null
                ? t('No stations available')
                : t('No current stations')
              : tn(_count, '{count} station mapped', '{count} stations mapped'),
        },
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    /**
     * Snapshot the station records as JSON-safe rows for the analyst query
     * engine.
     * @param {number} [maxCount=2000]
     * @returns {Array<object>}
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || !_stations.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      return _stations.slice(0, limit).map(mapSncfStationRecord);
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        // The catalogue's own total, so the row can say how big the network
        // is rather than only how many are drawn.
        total: _total || null,
      };
    },
  };
  return layer;
}
