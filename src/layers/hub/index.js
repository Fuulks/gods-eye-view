import {
  HUB_STATIONS_LAYER_ID,
  HUB_STATIONS_OVERLAY_SOURCE_ID,
  HUB_OVERLAY_COHORT_LIMIT,
  createHubOverlayEntry,
  hubSourceText,
  mapAnalystRecord,
  originColor,
} from './model.js';
import { isPointerFree } from '../../data/inputOwnership.js';
import { fromDegrees } from '../../geo/ellipsoid.js';
import { hexColor } from '../../render/color.js';
import { drawOf } from '../../render/rendererOf.js';
import { inputFor as defaultInputFor } from '../../input/dispatcher.js';
import {
  HUB_POLL_MS,
  classifyStation,
  hubIsCurrent,
  hubLayerText,
  stationLabel,
  stationVisual,
} from './freshness.js';
import { createStationCardPanel, stationCardModel } from './card.js';
export * from './model.js';
export { createHubSource } from './source.js';

const msg = (text) => text;
const LAYER_SOURCE_ID = 'stations';
const ENTITY_PREFIX = 'hub-station:';
const RELABEL_MS = 1000;
/** Each layer's draw sets have ids of their own. */
let instances = 0;

/**
 * OneIntOS station layer. Stations come from the same-origin hub proxy, are
 * normalized before use, drawn as an approximate-area ring plus a point, and
 * labelled through the overlay host with their data origin (LIVE, SIMULATED
 * or REPLAYED). Nothing from the hub is ever written as markup.
 */
export function createHubStationsLayer({
  source,
  overlayHost,
  picking = null,
  now = () => performance.now(),
  wallNow = Date.now,
  setTimer = (fn, ms) => setInterval(fn, ms),
  clearTimer = (handle) => clearInterval(handle),
  inputFor = defaultInputFor,
  doc = globalThis.document ?? null,
} = {}) {
  if (typeof source?.getStations !== 'function')
    throw new TypeError('Hub stations require a hub source');
  if (!overlayHost) throw new TypeError('Hub stations require an overlay host');
  let _viewer = null;
  let _request = null;
  let _sets = null;
  let _rows = [];
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _origin = null;
  let _receivedAtMs = null;
  let _lastSuccessMs = null;
  let _lastSuccessWallMs = null;
  let _timer = null;
  let _manager = null;
  let _paintedText = null;
  let _clickSubscription = null;
  let _selectedId = null;
  let _panel = null;
  const setBase = `${HUB_STATIONS_LAYER_ID}:${++instances}`;
  const _positions = new Map();

  const viewOf = (row, nowMs) =>
    classifyStation({
      row,
      receivedAtMs: _receivedAtMs,
      nowMs,
      lastSuccessMs: _lastSuccessMs,
    });

  /** The point and the approximate-area ring one station draws. */
  function itemsOf(row, position, visual, state) {
    const color = hexColor(visual.color, 1);
    const id = `${ENTITY_PREFIX}${row.id}`;
    // The position is deliberately approximate; the ring shows how approximate.
    const radius = Math.max(500, (row.precisionM ?? 10000) / 2);
    return {
      point: {
        id,
        pos: position,
        pixelSize: 9,
        color: [color[0], color[1], color[2], visual.pointAlpha],
        outlineColor: [0, 0, 0, 1],
        outlineWidth: 1,
        height: 'clampGround',
      },
      ring: {
        id,
        geometry: {
          kind: 'ellipse',
          center: { lon: row.lon, lat: row.lat },
          semiMajor: radius,
          semiMinor: radius,
        },
        fill: [color[0], color[1], color[2], visual.ringAlpha],
        outline: [color[0], color[1], color[2], state === 'fresh' ? 0.7 : 0.3],
        outlineWidth: 1,
        height: 'clampGround',
      },
    };
  }

  /** Re-derive everything time-dependent: labels, colours, layer text and the open card. */
  function refreshView() {
    if (!_sets) return;
    const nowMs = now();
    const entries = [];
    const states = [];
    const points = [];
    const rings = [];
    for (const row of _rows) {
      const view = viewOf(row, nowMs);
      states.push(view.state);
      const visual = stationVisual(row.origin, view.state);
      const position = _positions.get(row.id);
      if (position) {
        const items = itemsOf(row, position, visual, view.state);
        points.push(items.point);
        rings.push(items.ring);
      }
      if (position && entries.length < HUB_OVERLAY_COHORT_LIMIT)
        entries.push({
          ...createHubOverlayEntry({ row, position }),
          title: stationLabel(row, view),
          accent: visual.color,
        });
    }
    if (points.length) {
      _sets.points.upsert(points);
      _sets.rings.upsert(rings);
    }
    overlayHost.setEntries(HUB_STATIONS_OVERLAY_SOURCE_ID, entries, {
      cohortLimit: HUB_OVERLAY_COHORT_LIMIT,
      collisionCapacity: HUB_OVERLAY_COHORT_LIMIT,
      moving: false,
    });
    layer.source = hubLayerText({
      origin: _origin,
      states,
      hubCurrent: hubIsCurrent({ lastSuccessMs: _lastSuccessMs, nowMs }),
      lastSuccessWallMs: _lastSuccessWallMs,
    });
    renderCard(nowMs);
    repaintRow();
  }

  /**
   * The layer row's text is redrawn by the layer panel, which only does so when the manager publishes activity (after
   * a poll finishes). The 1 s tick changes `layer.source` on its own, so ask the manager to repaint when it changed;
   * without this the row shows NOT CURRENT only when the next poll attempt ends, up to a poll period late.
   */
  function repaintRow() {
    if (layer.source === _paintedText) return;
    _paintedText = layer.source;
    _manager?.refreshLayerStats?.();
  }

  function renderCard(nowMs = now()) {
    if (!_selectedId || !_panel) return;
    const row = _rows.find((r) => r.id === _selectedId);
    if (!row) return closeCard();
    _panel.render(
      stationCardModel({
        row,
        receivedAtMs: _receivedAtMs,
        nowMs,
        lastSuccessMs: _lastSuccessMs,
      }),
    );
  }

  function openCard(id) {
    if (!doc?.body) return;
    _panel ??= createStationCardPanel({ doc, host: doc.body });
    _selectedId = id;
    renderCard();
  }

  function closeCard() {
    _selectedId = null;
    _panel?.hide();
  }

  function startTick() {
    if (_timer !== null) return;
    _timer = setTimer(refreshView, RELABEL_MS);
  }

  function stopTick() {
    if (_timer === null) return;
    clearTimer(_timer);
    _timer = null;
  }

  /** The station a hit on one of this layer's items is, or null. */
  function hitStation(hit) {
    if (!hit?.set?.startsWith(`${setBase}:`)) return null;
    if (typeof hit.id !== 'string' || !hit.id.startsWith(ENTITY_PREFIX))
      return null;
    const stationId = hit.id.slice(ENTITY_PREFIX.length);
    return _rows.some((r) => r.id === stationId) ? stationId : null;
  }

  function installClicks(viewer) {
    if (!picking) return;
    // A viewer with no renderer input bound takes no clicks.
    let clicks = null;
    try {
      clicks = inputFor(viewer) ?? null;
    } catch {
      clicks = null;
    }
    if (!clicks) return;
    picking.registerPickOwner?.(HUB_STATIONS_LAYER_ID, (id) =>
      String(id).startsWith(ENTITY_PREFIX),
    );
    _clickSubscription = clicks.onClick((event) => {
      if (!isPointerFree() || !_enabled) return;
      const hit = event.drawHit;
      if (hit?.id?.startsWith?.(ENTITY_PREFIX)) {
        const stationId = hitStation(hit);
        if (stationId) openCard(stationId);
        return;
      }
      closeCard();
    });
  }

  function releaseClicks() {
    _clickSubscription?.();
    _clickSubscription = null;
    picking?.unregisterPickOwner?.(HUB_STATIONS_LAYER_ID);
  }

  const layer = {
    id: HUB_STATIONS_LAYER_ID,
    name: 'OneIntOS Stations',
    icon: '📡',
    source: hubSourceText(null),
    updateInterval: HUB_POLL_MS,

    /** @param {object|null} dataManager DataLayerManager; called once the manager exists (src/app/data.js). */
    attachDataManager(dataManager) {
      _manager = dataManager || null;
      _paintedText = layer.source;
    },

    init(viewer) {
      if (_viewer) throw new Error('Hub stations layer is already initialized');
      _viewer = viewer;
      const draw = drawOf(viewer);
      _sets = {
        rings: draw.shapes({
          id: `${setBase}:rings`,
          clampTo: 'both',
          show: false,
        }),
        points: draw.points({
          id: `${setBase}:points`,
          clampTo: 'both',
          show: false,
        }),
      };
      _rows = [];
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      _origin = null;
      _receivedAtMs = null;
      _lastSuccessMs = null;
      _lastSuccessWallMs = null;
      overlayHost.setVisible(HUB_STATIONS_OVERLAY_SOURCE_ID, false);
      installClicks(viewer);
    },

    enable() {
      _enabled = true;
      startTick();
      if (_sets) for (const set of Object.values(_sets)) set.show = true;
      overlayHost.setVisible(HUB_STATIONS_OVERLAY_SOURCE_ID, true);
      // Rows kept across a disable have aged: relabel now, not on the next tick.
      refreshView();
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      stopTick();
      closeCard();
      if (_sets) for (const set of Object.values(_sets)) set.show = false;
      overlayHost.clearSource(HUB_STATIONS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(HUB_STATIONS_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      if (!_enabled || !_sets) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const { origin, rows } = await source.getStations(LAYER_SOURCE_ID, {
          signal: request.signal,
        });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        const receivedAt = now();
        // Build everything first and swap it in at the end, so a failure part-way cannot leave the map and the
        // rows out of step. Repeated ids are ignored after the first.
        const unique = [];
        const positions = new Map();
        for (const row of rows) {
          if (positions.has(row.id)) continue;
          positions.set(row.id, fromDegrees(row.lon, row.lat, 0));
          unique.push(row);
        }
        const drawn = new Map();
        const fresh = stationVisual('live', 'fresh');
        for (const row of unique)
          drawn.set(
            row.id,
            itemsOf(
              row,
              positions.get(row.id),
              { ...fresh, color: originColor(row.origin) },
              'fresh',
            ),
          );
        _sets.points.set([...drawn.values()].map((i) => i.point));
        _sets.rings.set([...drawn.values()].map((i) => i.ring));
        _positions.clear();
        for (const [id, position] of positions) _positions.set(id, position);
        _rows = unique;
        _count = unique.length;
        _origin = origin;
        _receivedAtMs = receivedAt;
        _lastSuccessMs = receivedAt;
        _lastSuccessWallMs = wallNow();
        _lastUpdate = Date.now();
        refreshView();
        _lastError = null;
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _lastError = e?.message || msg('OneIntOS hub unavailable');
        // Keep the last stations on screen, but they age and the layer says it is not current.
        refreshView();
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy() {
      _request?.abort();
      stopTick();
      closeCard();
      releaseClicks();
      _request = null;
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(HUB_STATIONS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(HUB_STATIONS_OVERLAY_SOURCE_ID, false);
      if (_sets) {
        for (const set of Object.values(_sets)) set.dispose();
        _sets = null;
      }
      _rows = [];
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _positions.clear();
    },

    getAnalystRecords(maxCount = 500) {
      if (!_enabled) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 500;
      const nowMs = now();
      return _rows
        .slice(0, limit)
        .map((row) => mapAnalystRecord(row, viewOf(row, nowMs)));
    },

    getStats() {
      return { count: _count, lastUpdate: _lastUpdate, error: _lastError };
    },
  };
  return layer;
}
