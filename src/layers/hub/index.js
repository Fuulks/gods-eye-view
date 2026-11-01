import * as Cesium from 'cesium';
import {
  HUB_STATIONS_LAYER_ID,
  HUB_STATIONS_OVERLAY_SOURCE_ID,
  HUB_OVERLAY_COHORT_LIMIT,
  createHubOverlayEntry,
  hubSourceText,
  mapAnalystRecord,
  originColor,
} from './model.js';
export * from './model.js';
export { createHubSource } from './source.js';

const msg = (text) => text;
const LAYER_SOURCE_ID = 'stations';

/**
 * OneIntOS station layer. Stations come from the same-origin hub proxy, are
 * normalized before use, drawn as an approximate-area ring plus a point, and
 * labelled through the overlay host with their data origin (LIVE, SIMULATED
 * or REPLAYED). Nothing from the hub is ever written as markup.
 */
export function createHubStationsLayer({ source, overlayHost } = {}) {
  if (typeof source?.getStations !== 'function')
    throw new TypeError('Hub stations require a hub source');
  if (!overlayHost) throw new TypeError('Hub stations require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _rows = [];
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: HUB_STATIONS_LAYER_ID,
    name: 'OneIntOS Stations',
    icon: '📡',
    source: hubSourceText(null),
    updateInterval: 5000,

    init(viewer) {
      if (_viewer) throw new Error('Hub stations layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource(HUB_STATIONS_LAYER_ID);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _rows = [];
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(HUB_STATIONS_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(HUB_STATIONS_OVERLAY_SOURCE_ID, true);
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(HUB_STATIONS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(HUB_STATIONS_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const { origin, rows } = await source.getStations(LAYER_SOURCE_ID, {
          signal: request.signal,
        });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        const entities = [];
        const overlayEntries = [];
        for (const row of rows) {
          const position = Cesium.Cartesian3.fromDegrees(row.lon, row.lat);
          const color = Cesium.Color.fromCssColorString(originColor(row.origin));
          // The position is deliberately approximate; the ring shows how approximate.
          const radius = Math.max(500, (row.precisionM ?? 10000) / 2);
          entities.push(
            new Cesium.Entity({
              id: `hub-station:${row.id}`,
              position,
              point: {
                pixelSize: 9,
                color,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 1,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              ellipse: {
                semiMajorAxis: radius,
                semiMinorAxis: radius,
                material: new Cesium.ColorMaterialProperty(color.withAlpha(0.12)),
                outline: true,
                outlineColor: color.withAlpha(0.7),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              properties: {
                stationId: row.id,
                origin: row.origin,
                approximate: true,
              },
            }),
          );
          overlayEntries.push(createHubOverlayEntry({ row, position }));
        }
        _dataSource.entities.removeAll();
        for (const entity of entities) _dataSource.entities.add(entity);
        overlayHost.setEntries(
          HUB_STATIONS_OVERLAY_SOURCE_ID,
          overlayEntries.slice(0, HUB_OVERLAY_COHORT_LIMIT),
          {
            cohortLimit: HUB_OVERLAY_COHORT_LIMIT,
            collisionCapacity: HUB_OVERLAY_COHORT_LIMIT,
            moving: false,
          },
        );
        _rows = rows;
        _count = rows.length;
        layer.source = hubSourceText(origin);
        _lastUpdate = Date.now();
        _lastError = null;
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _lastError = e?.message || msg('OneIntOS hub unavailable');
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(HUB_STATIONS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(HUB_STATIONS_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _rows = [];
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    getAnalystRecords(maxCount = 500) {
      if (!_enabled) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 500;
      return _rows.slice(0, limit).map(mapAnalystRecord);
    },

    getStats() {
      return { count: _count, lastUpdate: _lastUpdate, error: _lastError };
    },
  };
  return layer;
}
