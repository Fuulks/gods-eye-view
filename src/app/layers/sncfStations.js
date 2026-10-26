import { createSncfStationsLayer } from '../../layers/sncfStations/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire the sncf-stations layer into the application catalog. */
export function createApplicationSncfStations(options) {
  return createSncfStationsLayer({ overlayHost, ...options });
}
