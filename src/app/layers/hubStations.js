import { createHubStationsLayer } from '../../layers/hub/index.js';
import * as picking from '../../data/pickRegistry.js';
import { overlayHost } from './overlayHost.js';
/** Wire the OneIntOS station layer to the application overlay host and click picking. */
export function createApplicationHubStations(options) {
  return createHubStationsLayer({ overlayHost, picking, ...options });
}
