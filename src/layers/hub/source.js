import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { normalizeHubStations } from './records.js';

const BASE = '/api/hub';
const MAX_BYTES = 1024 * 1024;
const LAYER_ID = /^[a-z0-9-]{1,40}$/;

/** Query string for the three parameters the layers API accepts; anything else is dropped. */
function query({ bbox, time, limit } = {}) {
  const params = new URLSearchParams();
  if (Array.isArray(bbox) && bbox.length === 4 && bbox.every(Number.isFinite))
    params.set('bbox', bbox.join(','));
  if (typeof time === 'string' && time) params.set('time', time);
  if (Number.isInteger(limit) && limit > 0) params.set('limit', String(limit));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * Portable client for the same-origin hub proxy. It never talks to OneIntOS
 * directly, never sees the token, and does not start any request or stream at
 * creation time.
 */
export function createHubSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  EventSourceImpl = globalThis.EventSource,
} = {}) {
  const url = (layerId, tail) => {
    if (!LAYER_ID.test(layerId)) throw new TypeError('Invalid hub layer id');
    return `${BASE}/layers/${layerId}/${tail}`;
  };
  return {
    /** Layer descriptors, or throws when the hub is off or unreachable. */
    async listLayers({ signal } = {}) {
      const response = await fetchImpl(`${BASE}/layers`, { signal });
      if (!response.ok)
        throw new Error(`Hub unavailable (HTTP ${response.status})`);
      const body = await readResponseJsonCapped(response, MAX_BYTES, signal);
      return Array.isArray(body?.layers) ? body.layers : [];
    },

    /** Normalized station records for one layer; throws on a malformed or unlabeled payload. */
    async getStations(layerId, options = {}) {
      const response = await fetchImpl(
        `${url(layerId, 'features')}${query(options)}`,
        { signal: options.signal },
      );
      if (!response.ok)
        throw new Error(`Hub unavailable (HTTP ${response.status})`);
      const result = normalizeHubStations(
        await readResponseJsonCapped(response, MAX_BYTES, options.signal),
      );
      if (!result) throw new Error('Malformed hub response');
      return result;
    },

    /**
     * Call `onSnapshot(result)` for every snapshot the stream pushes and
     * `onState('open' | 'connecting' | 'closed')` as it changes. The browser's
     * EventSource reconnects by itself. Returns an unsubscribe.
     */
    subscribe(layerId, onSnapshot, onState = () => {}, options = {}) {
      if (typeof EventSourceImpl !== 'function') {
        onState('closed');
        return () => {};
      }
      const events = new EventSourceImpl(
        `${url(layerId, 'stream')}${query(options)}`,
      );
      const states = ['connecting', 'open', 'closed'];
      const report = () => onState(states[events.readyState] ?? 'connecting');
      events.onopen = report;
      events.onerror = report;
      events.addEventListener('snapshot', (event) => {
        try {
          const result = normalizeHubStations(JSON.parse(event.data));
          if (result) onSnapshot(result);
        } catch {
          /* ignore a malformed frame; the next one replaces it */
        }
      });
      return () => events.close();
    },
  };
}
