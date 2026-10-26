/**
 * The French passenger-station network, read through the server proxy.
 *
 * The browser NEVER names an upstream URL: it asks the local proxy for the
 * `stations` route, and the proxy resolves the OpenDataSoft catalogue URL
 * from its own server-side allow-list.
 */
import { normalizeSncfStationPayload } from './model.js';

// A portable export (package.json): no i18n here. Failures stay English data;
// the Layers panel shows them translated.
const msg = (text) => text;

/** The local proxy route that serves the station catalogue. */
export const SNCF_STATIONS_ENDPOINT = '/api/sncf/stations';

/**
 * Construct the SNCF station source.
 *
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - Injected fetch, for tests.
 * @param {string} [options.endpoint] - The proxy route to read.
 * @returns {{getSnapshot: Function}}
 */
export function createSncfStationsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  endpoint = SNCF_STATIONS_ENDPOINT,
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(endpoint, {
        signal,
        cache: 'no-store',
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        // The status below stays authoritative.
      }
      signal?.throwIfAborted();
      if (!response.ok) {
        throw new Error(`SNCF HTTP ${response.status}`);
      }
      const normalized = normalizeSncfStationPayload(payload);
      if (!normalized) throw new Error(msg('Malformed station response'));
      return normalized;
    },
  };
}
