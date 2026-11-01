/**
 * What the hub layer may claim about how current a station is. Pure functions, no clocks of their own:
 * callers pass monotonic times so tests and the browser agree.
 *
 * The rule that matters: nothing is shown as current unless the last poll succeeded recently, the hub said the
 * station is fresh, and its age (the hub's age plus the time since that answer arrived) is still within the
 * thresholds the hub sent. Everything else is stale, offline or "not current".
 */
import { originColor, originLabel } from './model.js';

export const HUB_POLL_MS = 5000;
/** Two missed polls plus a 2 s grace. */
export const HUB_NOT_CURRENT_AFTER_MS = 12000;
const SEVERITY = { fresh: 0, stale: 1, offline: 2 };

export function formatAge(ageS) {
  if (!Number.isFinite(ageS) || ageS < 0) return null;
  if (ageS < 90) return `${Math.round(ageS)} s`;
  if (ageS < 5400) return `${Math.round(ageS / 60)} min`;
  if (ageS < 172800) return `${Math.round(ageS / 3600)} h`;
  return `${Math.round(ageS / 86400)} d`;
}

/** `HH:MM:SSZ` from a canonical UTC timestamp, or null. */
export function clockOf(iso) {
  return typeof iso === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(iso)
    ? `${iso.slice(11, 19)}Z`
    : null;
}

/** `HH:MM:SSZ` from wall-clock milliseconds, or null. */
export function clockOfMs(ms) {
  return Number.isFinite(ms) ? clockOf(new Date(ms).toISOString()) : null;
}

export function hubIsCurrent({ lastSuccessMs, nowMs }) {
  return (
    Number.isFinite(lastSuccessMs) &&
    Number.isFinite(nowMs) &&
    nowMs - lastSuccessMs <= HUB_NOT_CURRENT_AFTER_MS
  );
}

/**
 * @param {object} p
 * @param {object} p.row A normalized station row.
 * @param {number|null} p.receivedAtMs Monotonic time the row's answer arrived.
 * @param {number} p.nowMs Monotonic now.
 * @param {number|null} p.lastSuccessMs Monotonic time of the last successful poll.
 * @returns {{state: 'fresh'|'stale'|'offline'|'unknown', current: boolean, hubCurrent: boolean, ageS: number|null, suffix: string}}
 */
export function classifyStation({ row, receivedAtMs, nowMs, lastSuccessMs }) {
  const hubCurrent = hubIsCurrent({ lastSuccessMs, nowMs });
  const known =
    row &&
    row.freshness in SEVERITY &&
    Number.isFinite(row.ageS) &&
    Number.isFinite(row.staleAfterS) &&
    Number.isFinite(row.offlineAfterS) &&
    Number.isFinite(receivedAtMs);
  if (!known) {
    return {
      state: 'unknown',
      current: false,
      hubCurrent,
      ageS: null,
      suffix: 'NOT CURRENT',
    };
  }
  const ageS = row.ageS + Math.max(0, (nowMs - receivedAtMs) / 1000);
  const derived =
    ageS <= row.staleAfterS
      ? 'fresh'
      : ageS <= row.offlineAfterS
        ? 'stale'
        : 'offline';
  // The worse of what the hub said and what the age now implies: the hub cannot make a station look better.
  let state =
    SEVERITY[row.freshness] >= SEVERITY[derived] ? row.freshness : derived;
  if (!hubCurrent && state === 'fresh') state = 'stale';
  const age = formatAge(ageS);
  let suffix;
  if (state === 'offline') {
    const seen = clockOf(row.lastIngestAt);
    suffix = `OFFLINE · last seen ${seen ?? 'unknown'}`;
  } else if (!hubCurrent) {
    suffix = age ? `NOT CURRENT · ${age}` : 'NOT CURRENT';
  } else if (state === 'stale') {
    suffix = age ? `STALE ${age}` : 'STALE';
  } else {
    suffix = '';
  }
  return {
    state,
    current: state === 'fresh' && hubCurrent,
    hubCurrent,
    ageS,
    suffix,
  };
}

/** The overlay label for a station: always the origin and id, then why it is not current. */
export function stationLabel(row, view) {
  const base = `${originLabel(row.origin)} · ${row.id}`;
  return view.suffix ? `${base} · ${view.suffix}` : base;
}

function mixHex(hex, toward, amount) {
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(toward.slice(i, i + 2), 16));
  return `#${a
    .map((v, i) =>
      Math.round(v + (b[i] - v) * amount)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Colour and opacity for the point and ring: dimmed when stale, grey when offline. */
export function stationVisual(origin, state) {
  const base = originColor(origin);
  if (state === 'fresh') return { color: base, pointAlpha: 1, ringAlpha: 0.12 };
  if (state === 'offline')
    return { color: '#7a7a7a', pointAlpha: 0.6, ringAlpha: 0.05 };
  return {
    color: mixHex(base, '#303030', 0.5),
    pointAlpha: 0.45,
    ringAlpha: 0.06,
  };
}

/** The layer panel's source text, stating the origin and, when needed, why the data may not be current. */
export function hubLayerText({
  origin,
  states,
  hubCurrent,
  lastSuccessWallMs,
}) {
  const head = origin ? `OneIntOS · ${originLabel(origin)}` : 'OneIntOS';
  if (!hubCurrent) {
    const last = clockOfMs(lastSuccessWallMs);
    return `${head} · NOT CURRENT · ${last ? `last poll ${last}` : 'no data yet'}`;
  }
  const worst = [...(states ?? [])].reduce(
    (w, s) =>
      s === 'unknown'
        ? s
        : w === 'unknown'
          ? w
          : (SEVERITY[s] ?? 0) > (SEVERITY[w] ?? 0)
            ? s
            : w,
    'fresh',
  );
  if (worst === 'fresh') return head;
  return `${head} · ${worst === 'unknown' ? 'NOT CURRENT' : worst.toUpperCase()}`;
}
