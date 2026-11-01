import * as Cesium from 'cesium';
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
  createInputHandler = (canvas) => new Cesium.ScreenSpaceEventHandler(canvas),
  doc = globalThis.document ?? null,
} = {}) {
  if (typeof source?.getStations !== 'function')
    throw new TypeError('Hub stations require a hub source');
  if (!overlayHost) throw new TypeError('Hub stations require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
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
  let _handler = null;
  let _selectedId = null;
  let _panel = null;
  const _entities = new Map();
  const _positions = new Map();

  const viewOf = (row, nowMs) =>
    classifyStation({
      row,
      receivedAtMs: _receivedAtMs,
      nowMs,
      lastSuccessMs: _lastSuccessMs,
    });

  function applyVisual(entity, origin, state) {
    const visual = stationVisual(origin, state);
    const color = Cesium.Color.fromCssColorString(visual.color);
    entity.point.color = color.withAlpha(visual.pointAlpha);
    entity.ellipse.material = new Cesium.ColorMaterialProperty(
      color.withAlpha(visual.ringAlpha),
    );
    entity.ellipse.outlineColor = color.withAlpha(
      state === 'fresh' ? 0.7 : 0.3,
    );
    return visual;
  }

  /** Re-derive everything time-dependent: labels, colours, layer text and the open card. */
  function refreshView() {
    if (!_dataSource) return;
    const nowMs = now();
    const entries = [];
    const states = [];
    for (const row of _rows) {
      const view = viewOf(row, nowMs);
      states.push(view.state);
      const entity = _entities.get(row.id);
      const visual = entity
        ? applyVisual(entity, row.origin, view.state)
        : stationVisual(row.origin, view.state);
      const position = _positions.get(row.id);
      if (position && entries.length < HUB_OVERLAY_COHORT_LIMIT)
        entries.push({
          ...createHubOverlayEntry({ row, position }),
          title: stationLabel(row, view),
          accent: visual.color,
        });
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
        nowWallMs: wallNow(),
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

  function installClicks(viewer) {
    if (!picking || !viewer?.scene?.canvas) return;
    picking.registerPickOwner?.(HUB_STATIONS_LAYER_ID, (id) =>
      String(id).startsWith(ENTITY_PREFIX),
    );
    _handler = createInputHandler(viewer.scene.canvas);
    _handler.setInputAction((click) => {
      if (!isPointerFree() || !_enabled) return;
      const picked = viewer.scene.pick(click.position);
      const id = picking.resolvePickId?.(picked) ?? null;
      if (id && String(id).startsWith(ENTITY_PREFIX)) {
        const stationId = String(id).slice(ENTITY_PREFIX.length);
        if (_rows.some((r) => r.id === stationId)) openCard(stationId);
        return;
      }
      closeCard();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function releaseClicks() {
    _handler?.destroy();
    _handler = null;
    picking?.unregisterPickOwner?.(HUB_STATIONS_LAYER_ID);
  }

  const layer = {
    id: HUB_STATIONS_LAYER_ID,
    name: 'OneIntOS Stations',
    icon: '📡',
    source: hubSourceText(null),
    updateInterval: HUB_POLL_MS,

    init(viewer) {
      if (_viewer) throw new Error('Hub stations layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource(HUB_STATIONS_LAYER_ID);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
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
      if (_dataSource) _dataSource.show = true;
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
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(HUB_STATIONS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(HUB_STATIONS_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
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
        const built = new Map();
        const positions = new Map();
        for (const row of rows) {
          if (built.has(row.id)) continue;
          const position = Cesium.Cartesian3.fromDegrees(row.lon, row.lat);
          const color = Cesium.Color.fromCssColorString(
            originColor(row.origin),
          );
          // The position is deliberately approximate; the ring shows how approximate.
          const radius = Math.max(500, (row.precisionM ?? 10000) / 2);
          built.set(
            row.id,
            new Cesium.Entity({
              id: `${ENTITY_PREFIX}${row.id}`,
              position,
              point: {
                pixelSize: 9,
                color,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 1,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              ellipse: {
                semiMajorAxis: radius,
                semiMinorAxis: radius,
                material: new Cesium.ColorMaterialProperty(
                  color.withAlpha(0.12),
                ),
                outline: true,
                outlineColor: color.withAlpha(0.7),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              properties: {
                stationId: row.id,
                origin: row.origin,
                approximate: true,
              },
            }),
          );
          positions.set(row.id, position);
          unique.push(row);
        }
        _dataSource.entities.removeAll();
        _entities.clear();
        _positions.clear();
        for (const [id, entity] of built) {
          _dataSource.entities.add(entity);
          _entities.set(id, entity);
          _positions.set(id, positions.get(id));
        }
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

    destroy(viewer = _viewer) {
      _request?.abort();
      stopTick();
      closeCard();
      releaseClicks();
      _request = null;
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(HUB_STATIONS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(HUB_STATIONS_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _rows = [];
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _entities.clear();
      _positions.clear();
    },

    getAnalystRecords(maxCount = 500) {
      if (!_enabled) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 500;
      return _rows.slice(0, limit).map(mapAnalystRecord);
    },

    getStats() {
      return { count: _count, lastUpdate: _lastUpdate, error: _lastError };
    },
  };
  return layer;
}
