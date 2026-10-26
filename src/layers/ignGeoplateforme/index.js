import * as Cesium from 'cesium';
import { msg, t } from '../../i18n/index.js';
import { translateFeedError } from '../../ui/statusText.js';
import { IGN_DESCRIPTION } from './model.js';
export * from './model.js';
export { createIgnGeoplateformeSource } from './source.js';

/**
 * Own one topographic imagery overlay and its refresh lifecycle.
 *
 * This layer contributes a tile template rather than entities: the globe asks
 * the LOCAL proxy for each tile, and the proxy resolves the upstream IGN URL
 * from its own allow-list. The browser never names an upstream URL.
 *
 * The VECTOR cadastre is deliberately not offered: the Géoplateforme serves
 * it over WMS GetMap, which answers 500 for many requests. The layer says so
 * in its row instead of offering a link that fails.
 */
export function createIgnGeoplateformeLayer({ source } = {}) {
  if (typeof source?.getDescriptor !== 'function')
    throw new TypeError('IGN Geoplateforme requires a descriptor source');
  let _viewer = null;
  let _imagery = null;
  let _enabled = false;
  let _lastUpdate = null;
  let _lastError = null;
  let rowControlsListener = null;

  const notify = () => rowControlsListener?.();

  const layer = {
    id: 'ign-geoplateforme',
    name: 'IGN Plan IGN',
    icon: '🗺️',
    source: 'IGN Géoplateforme',
    updateInterval: 0,

    init(viewer) {
      if (_viewer) throw new Error('IGN layer is already initialized');
      _viewer = viewer;
      _enabled = false;
      _lastUpdate = null;
      _lastError = null;
    },

    enable(viewer = _viewer) {
      if (!viewer) throw new Error('IGN layer is not initialized');
      _enabled = true;
      try {
        const descriptor = source.getDescriptor();
        if (!_imagery) {
          _imagery = new Cesium.UrlTemplateImageryProvider({
            url: descriptor.url,
            maximumLevel: descriptor.maximumLevel ?? 19,
            credit: descriptor.credit ?? msg('IGN Géoplateforme'),
          });
          viewer.imageryLayers.addImageryProvider(_imagery);
        }
        _imagery.show = true;
        _lastError = null;
        _lastUpdate = Date.now();
      } catch (error) {
        console.warn('[Data:IGN] Enable error:', error);
        _lastError = error?.message || msg('IGN imagery unavailable');
      }
      notify();
    },

    disable(viewer = _viewer) {
      _enabled = false;
      if (_imagery) _imagery.show = false;
      notify();
    },

    async update() {
      // The imagery provider fetches tiles on its own; there is nothing to
      // poll. The layer is a pure overlay.
      if (!_enabled) return false;
      return true;
    },

    destroy(viewer = _viewer) {
      _enabled = false;
      if (_imagery && viewer) {
        try {
          viewer.imageryLayers.remove(_imagery);
        } catch {
          // The layer may already be gone with the viewer.
        }
      }
      _imagery = null;
      _viewer = null;
      _lastUpdate = null;
      _lastError = null;
      rowControlsListener = null;
    },

    /** Readout descriptor for the Layers panel. */
    getRowControls() {
      return {
        readout: true,
        summary: {
          label: t('IGN Plan IGN'),
          coverage: t(IGN_DESCRIPTION),
          validTime: _lastUpdate
            ? new Date(_lastUpdate).toISOString()
            : undefined,
          status: _lastError
            ? translateFeedError(_lastError)
            : _enabled
              ? t('Raster tiles · vector cadastre unavailable')
              : t('Off'),
        },
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    getStats() {
      return {
        // An imagery overlay has no countable entities; the count is the
        // number of tile layers the globe is showing.
        count: _imagery && _imagery.show ? 1 : 0,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
