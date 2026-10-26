/**
 * The IGN Géoplateforme raster basemap, read through the local proxy.
 *
 * This layer is an imagery overlay rather than a point layer: it contributes
 * a tile template, and the globe asks the LOCAL proxy for each tile. The
 * browser never names an upstream URL.
 */
import { ignImageryDescriptor } from './model.js';

// A portable export (package.json): no i18n here.
const msg = (text) => text;

/**
 * Build the imagery source.
 * @param {object} [options]
 * @param {string} [options.layer='PLANIGNV2'] The raster layer to request.
 * @returns {{getDescriptor: Function}}
 */
export function createIgnGeoplateformeSource({ layer = 'PLANIGNV2' } = {}) {
  return {
    getDescriptor() {
      return ignImageryDescriptor(layer);
    },
  };
}
