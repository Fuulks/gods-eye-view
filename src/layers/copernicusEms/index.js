import * as Cesium from 'cesium';
import { msg, t, tn } from '../../i18n/index.js';
import { translateFeedError } from '../../ui/statusText.js';
import {
  COPERNICUS_DESCRIPTION,
  COPERNICUS_OVERLAY_COLLISION_CAPACITY,
  COPERNICUS_OVERLAY_COHORT_LIMIT,
  COPERNICUS_OVERLAY_SOURCE_ID,
  copernicusCategoryColor,
  copernicusCategoryLabel,
  createCopernicusOverlayEntry,
  mapCopernicusRecord,
  selectCopernicusOverlayCohort,
} from './model.js';
export * from './model.js';
export { createCopernicusEmsSource } from './source.js';

/** Activation markers are a point anchor, not an extent. */
const ACTIVATION_MARKER_RADIUS_M = 12_000;

/**
 * Own one Copernicus EMS activation display: the active civil-protection
 * activations as selectable ground anchors.
 */
export function createCopernicusEmsLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Copernicus EMS requires a snapshot source');
  if (!overlayHost)
    throw new TypeError('Copernicus EMS requires an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _activations = [];
  let _total = 0;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let rowControlsListener = null;

  const notify = () => rowControlsListener?.();

  const layer = {
    id: 'copernicus-ems',
    name: 'Copernicus EMS',
    icon: '🆘',
    source: 'Copernicus EMS',
    updateInterval: 30 * 60_000,

    init(viewer) {
      if (_viewer) throw new Error('Copernicus EMS layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('copernicus-ems');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _activations = [];
      _total = 0;
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(COPERNICUS_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(COPERNICUS_OVERLAY_SOURCE_ID, true);
      notify();
    },

    disable() {
      // Abort in flight: a response arriving after disable must not redraw.
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(COPERNICUS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(COPERNICUS_OVERLAY_SOURCE_ID, false);
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
        _activations = snapshot.activations;
        _total = snapshot.total;
        this._render();
        _count = _activations.length;
        _lastUpdate = Date.now();
        _lastError = null;
        notify();
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request) return false;
        _lastError = error?.message || msg('Activation feed unavailable');
        console.warn('[Data:CopernicusEMS] Refresh failed:', _lastError);
        notify();
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    /** Rebuild entities and overlay labels from the current activations. */
    _render() {
      if (!_dataSource) return;
      _dataSource.entities.removeAll();
      const overlayEntries = [];
      for (const activation of _activations) {
        const position = Cesium.Cartesian3.fromDegrees(
          activation.lon,
          activation.lat,
        );
        const color = Cesium.Color.fromCssColorString(activation.color);
        _dataSource.entities.add(
          new Cesium.Entity({
            id: `copernicus-activation:${activation.id}`,
            position,
            ellipse: {
              // Static axes, as in the earthquake layer: a per-frame axis
              // re-tessellates the clamped ground primitive every frame.
              semiMajorAxis: ACTIVATION_MARKER_RADIUS_M,
              semiMinorAxis: ACTIVATION_MARKER_RADIUS_M,
              material: new Cesium.ColorMaterialProperty(color.withAlpha(0.35)),
              outline: true,
              outlineColor: color.withAlpha(0.9),
              outlineWidth: 2,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
            properties: {
              name: activation.name,
              code: activation.code,
              category: activation.category,
              categoryLabel: activation.categoryLabel,
              phase: activation.phase,
              phaseLabel: activation.phaseLabel,
              country: activation.country,
              lat: activation.lat,
              lon: activation.lon,
            },
          }),
        );
        overlayEntries.push(
          createCopernicusOverlayEntry({
            id: activation.id,
            position,
            title: activation.code || activation.name,
            accent: activation.color,
          }),
        );
      }
      if (_enabled) {
        overlayHost.setEntries(
          COPERNICUS_OVERLAY_SOURCE_ID,
          selectCopernicusOverlayCohort(overlayEntries),
          {
            cohortLimit: COPERNICUS_OVERLAY_COHORT_LIMIT,
            collisionCapacity: COPERNICUS_OVERLAY_COLLISION_CAPACITY,
            moving: false,
          },
        );
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      overlayHost.clearSource(COPERNICUS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(COPERNICUS_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer?.dataSources?.remove(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _activations = [];
      _total = 0;
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      rowControlsListener = null;
    },

    /** Readout descriptor for the Layers panel. */
    getRowControls() {
      const categories = [
        ...new Set(_activations.map((entry) => entry.category)),
      ];
      const status = _lastError
        ? translateFeedError(_lastError)
        : _count === 0
          ? _lastUpdate === null
            ? t('No activations available')
            : t('No active activations')
          : tn(
              _count,
              '{count} active activation',
              '{count} active activations',
            );
      return {
        readout: true,
        summary: {
          label: t('Copernicus EMS'),
          coverage: t(COPERNICUS_DESCRIPTION),
          validTime: _lastUpdate
            ? new Date(_lastUpdate).toISOString()
            : undefined,
          status,
        },
        legend: categories.map((category) => ({
          color: copernicusCategoryColor(category),
          label: t(copernicusCategoryLabel(category)),
        })),
        legendCategorical: true,
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    /**
     * Snapshot the activation records as JSON-safe rows for the analyst
     * query engine.
     * @param {number} [maxCount=500]
     * @returns {Array<object>}
     */
    getAnalystRecords(maxCount = 500) {
      if (!_enabled || !_activations.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 500;
      return _activations.slice(0, limit).map(mapCopernicusRecord);
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        total: _total || null,
      };
    },
  };
  return layer;
}
