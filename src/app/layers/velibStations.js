import { createVelibStationsLayer } from '../../layers/velibStations/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire the velib-stations layer into the application catalog. */
export function createApplicationVelibStations(options) {
  return createVelibStationsLayer({ overlayHost, ...options });
}
