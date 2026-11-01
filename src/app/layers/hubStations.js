import { createHubStationsLayer } from '../../layers/hub/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire the OneIntOS station layer to the application overlay host. */
export function createApplicationHubStations(options) {
  return createHubStationsLayer({ overlayHost, ...options });
}
