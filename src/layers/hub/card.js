/**
 * The station card: a dedicated DOM panel (the spike showed the world overlay paints card text on a canvas, so
 * it is not a safe or accessible home for multi-line station detail). Everything hub-supplied reaches the page
 * through createElement and textContent only, never as markup. Times are UTC ISO strings ending in Z.
 */
import { t } from '../../i18n/index.js';
import { originColor, originLabel } from './model.js';
import { classifyStation, formatAge } from './freshness.js';

const STATE_TEXT = Object.freeze({
  fresh: 'FRESH',
  stale: 'STALE',
  offline: 'OFFLINE',
  unknown: 'NOT CURRENT',
});

function when(iso, nowWallMs) {
  if (!iso) return t('unknown');
  const ms = Date.parse(iso);
  const rel = Number.isFinite(ms) ? formatAge((nowWallMs - ms) / 1000) : null;
  return rel ? `${iso} (${rel} ago)` : iso;
}

/**
 * Pure content of the card, so tests assert text without a DOM.
 * @returns {{title: string, accent: string, status: string, notCurrent: boolean, lines: string[], sensors: string[][]}}
 */
export function stationCardModel({
  row,
  receivedAtMs,
  nowMs,
  lastSuccessMs,
  nowWallMs,
}) {
  const view = classifyStation({ row, receivedAtMs, nowMs, lastSuccessMs });
  const status = view.hubCurrent
    ? STATE_TEXT[view.state]
    : view.state === 'offline'
      ? STATE_TEXT.offline
      : STATE_TEXT.unknown;
  const offlineFor = view.ageS === null ? null : formatAge(view.ageS);
  const statusText =
    status === STATE_TEXT.offline
      ? `${status} (${offlineFor ? `no data for ${offlineFor}` : 'no recent data'})`
      : status;
  const lines = [
    `${t('Freshness')}: ${statusText}${view.hubCurrent ? '' : ` · ${t('hub not reachable')}`}`,
    `${t('Age')}: ${view.ageS === null ? t('unknown') : (formatAge(view.ageS) ?? t('unknown'))}`,
    `${t('Last ingest')}: ${when(row.lastIngestAt, nowWallMs)}`,
    `${t('Expected interval')}: ${
      Number.isFinite(row.expectedIntervalS)
        ? (formatAge(row.expectedIntervalS) ?? t('unknown'))
        : t('unknown')
    }`,
    `${t('Position approximate')}${
      row.precisionM ? ` (±${Math.round(row.precisionM / 2)} m)` : ''
    }`,
  ];
  const sensors = row.readings.map((r) => {
    const q = r.quality?.status ? ` · ${r.quality.status}` : '';
    const c = Number.isFinite(r.quality?.confidence)
      ? ` ${Math.round(r.quality.confidence * 100)}%`
      : '';
    return [
      `${r.sensorId} · ${r.metric}: ${r.value}${r.unit ? ` ${r.unit}` : ''}${q}${c}`,
      `${t('Observed')}: ${when(r.observedAt, nowWallMs)}`,
      `${t('Received')}: ${when(r.receivedAt, nowWallMs)}`,
      `${t('Delay')}: ${
        Number.isFinite(r.delayS)
          ? (formatAge(Math.max(0, r.delayS)) ?? t('unknown'))
          : t('unknown')
      }`,
    ];
  });
  return {
    title: `${originLabel(row.origin)} · ${row.id}`,
    accent: originColor(row.origin),
    status: statusText,
    notCurrent: !view.current,
    lines,
    sensors,
  };
}

/** Build the card element tree from a model. Text only. */
export function renderStationCard(doc, model, element = null) {
  const root = element ?? doc.createElement('section');
  root.replaceChildren();
  const add = (parent, tag, text, extra) => {
    const el = doc.createElement(tag);
    el.textContent = text;
    if (extra) Object.assign(el.style, extra);
    parent.appendChild(el);
    return el;
  };
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', model.title);
  add(root, 'h3', model.title, { margin: '0 0 4px', color: model.accent });
  add(root, 'p', model.status, {
    margin: '0 0 6px',
    fontWeight: '700',
    color: model.notCurrent ? '#ffb300' : '#3ddc84',
  });
  for (const line of model.lines) add(root, 'p', line, { margin: '0 0 2px' });
  for (const sensor of model.sensors) {
    const block = doc.createElement('div');
    block.style.marginTop = '6px';
    sensor.forEach((line, i) =>
      add(block, 'p', line, {
        margin: '0 0 1px',
        fontWeight: i === 0 ? '700' : '400',
      }),
    );
    root.appendChild(block);
  }
  return root;
}

/** The mounted panel: show a station, re-render as time passes, hide. */
export function createStationCardPanel({ doc, host }) {
  let element = null;
  return {
    render(model) {
      if (!element) {
        element = doc.createElement('section');
        Object.assign(element.style, {
          position: 'fixed',
          right: '16px',
          bottom: '16px',
          maxWidth: '340px',
          padding: '10px 12px',
          background: 'rgba(16,18,22,0.92)',
          color: '#e8e8e8',
          font: '12px/1.4 system-ui, sans-serif',
          border: '1px solid #444',
          zIndex: '20',
        });
        host.appendChild(element);
      }
      renderStationCard(doc, model, element);
    },
    hide() {
      element?.remove();
      element = null;
    },
    isShown: () => element !== null,
  };
}
