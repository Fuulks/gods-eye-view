/**
 * @module layers/ghostMaps/markers
 * @description The Ghost Maps point markers: a small fixed set of flat,
 * single-colour sprites drawn here, instead of the image each KMZ placemark
 * packs for itself.
 *
 * WHY NOT THE KMZ'S OWN ICONS: an ArcGIS export packs an icon per style, up to
 * half a megabyte each. Each one was decoded into its own blob URL and its own
 * GPU texture, on a ground-clamped billboard with depth testing off. The
 * markers are small flat symbols; the packed art added texture uploads and
 * memory, not information, and did not match the rest of the app's markers.
 *
 * The sprites are WHITE with a dark outline so a billboard's `color` tints
 * them: every placemark of a kind shares ONE texture, and the tint carries
 * the product (or the KML style's own) colour. The shape follows the icon's
 * name (the usual Google Earth shapes), so a KML that draws squares and
 * triangles still reads as squares and triangles.
 */

/** The marker shapes, in no particular order. */
export const GHOST_MARKER_KINDS = Object.freeze([
  'disc',
  'square',
  'triangle',
  'diamond',
  'star',
]);

/** The shape used when the icon's name says nothing. */
export const GHOST_MARKER_DEFAULT_KIND = 'disc';

/** Sprite edge in pixels. The billboard scale sets the on-screen size. */
export const GHOST_MARKER_SIZE = 28;

/**
 * The marker shape for a KML icon reference.
 *
 * Only the file's own name is read (`shapes/triangle.png`,
 * `placemark_square.png`); the path and any query are ignored, so a remote or
 * odd href can only ever select one of the shapes above.
 *
 * @param {string|null|undefined} href The KML `Icon/href`.
 * @returns {string} One of GHOST_MARKER_KINDS.
 */
export function ghostMarkerKind(href) {
  const name = String(href ?? '')
    .split(/[?#]/)[0]
    .split(/[\\/]/)
    .pop()
    .toLowerCase();
  for (const kind of GHOST_MARKER_KINDS) {
    if (kind !== GHOST_MARKER_DEFAULT_KIND && name.includes(kind)) return kind;
  }
  return GHOST_MARKER_DEFAULT_KIND;
}

/**
 * Whether a KML icon colour is "no tint": white, or near it. ArcGIS writes
 * `ffffffff` when the packed image carries its own colour; tinting the flat
 * white sprite with it would draw a white marker, so the product colour is
 * used instead.
 *
 * @param {number[]|null|undefined} rgba Channels 0..1.
 * @returns {boolean}
 */
export function isNeutralTint(rgba) {
  if (!Array.isArray(rgba) || rgba.length < 3) return true;
  return rgba[0] > 0.95 && rgba[1] > 0.95 && rgba[2] > 0.95;
}

/**
 * Trace one marker shape on a 2D context. Pure drawing: it fills white and
 * strokes the outline, and touches nothing else.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} kind One of GHOST_MARKER_KINDS.
 * @param {number} [size] Sprite edge in pixels.
 */
export function drawGhostMarker(ctx, kind, size = GHOST_MARKER_SIZE) {
  const c = size / 2;
  const r = size * 0.32;
  ctx.beginPath();
  if (kind === 'square') {
    ctx.rect(c - r, c - r, r * 2, r * 2);
  } else if (kind === 'triangle') {
    ctx.moveTo(c, c - r * 1.15);
    ctx.lineTo(c + r * 1.05, c + r * 0.85);
    ctx.lineTo(c - r * 1.05, c + r * 0.85);
    ctx.closePath();
  } else if (kind === 'diamond') {
    ctx.moveTo(c, c - r * 1.2);
    ctx.lineTo(c + r * 1.2, c);
    ctx.lineTo(c, c + r * 1.2);
    ctx.lineTo(c - r * 1.2, c);
    ctx.closePath();
  } else if (kind === 'star') {
    for (let i = 0; i < 10; i += 1) {
      const radius = i % 2 === 0 ? r * 1.25 : r * 0.55;
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = c + Math.cos(angle) * radius;
      const y = c + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  } else {
    ctx.arc(c, c, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.stroke();
}

const spriteCache = new Map();

/**
 * The shared sprite for a marker shape, as an image URL, drawn once.
 *
 * @param {string} kind One of GHOST_MARKER_KINDS.
 * @param {Document} [documentRef]
 * @returns {string|null} A data URL, or null where there is no canvas.
 */
export function ghostMarkerImage(kind, documentRef = globalThis.document) {
  const key = GHOST_MARKER_KINDS.includes(kind)
    ? kind
    : GHOST_MARKER_DEFAULT_KIND;
  if (spriteCache.has(key)) return spriteCache.get(key);
  let url = null;
  try {
    const canvas = documentRef.createElement('canvas');
    canvas.width = canvas.height = GHOST_MARKER_SIZE;
    drawGhostMarker(canvas.getContext('2d'), key, GHOST_MARKER_SIZE);
    url = canvas.toDataURL();
  } catch {
    url = null;
  }
  if (url) spriteCache.set(key, url);
  return url;
}

/** Forget the drawn sprites (tests, and a document that is going away). */
export function clearGhostMarkerCache() {
  spriteCache.clear();
}
