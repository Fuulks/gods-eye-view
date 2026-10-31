/**
 * @module layers/ghostMaps/markers
 * @description The Ghost Maps point symbols: one small monoline cyan symbol
 * per kind of event, drawn here instead of the image each KMZ placemark packs
 * for itself.
 *
 * WHY NOT THE KMZ'S OWN ICONS: an ArcGIS export packs an icon per style, up to
 * half a megabyte each. Each one was decoded into its own blob URL and its own
 * GPU texture, on a ground-clamped billboard with depth testing off. The packed
 * art added texture uploads and memory, did not say what kind of event a
 * placemark was, and did not match the app.
 *
 * THE SET: a dark chamfered plate with a thin cyan frame (the Cyber theme's
 * instrument look, in its `#00d4ff` accent) and one glyph inside. A sprite is
 * drawn once per kind and shared by every placemark of that kind, so the whole
 * layer holds at most KINDS.length textures.
 *
 * THE KIND of a placemark is read from what the export actually says about
 * it: its folder, its name, the file name of its icon, and the value of a
 * `Type`/`Category`-style row of its popup table. The long description is NOT
 * scanned: it is full of words (`strike`, `fire`) that describe something
 * else. A placemark that says nothing recognisable is a plain `report`.
 */

/**
 * The event kinds, in the order the rules below are tried.
 * `report` is the fallback.
 */
export const GHOST_MARKER_KINDS = Object.freeze([
  'missile',
  'drone',
  'air',
  'naval',
  'strike',
  'clash',
  'fire',
  'casualty',
  'unrest',
  'checkpoint',
  'displacement',
  'facility',
  'report',
]);

/** The kind used when nothing in a placemark names one. */
export const GHOST_MARKER_DEFAULT_KIND = 'report';

/** Sprite edge in pixels (drawn large, shown small, so it stays crisp). */
export const GHOST_MARKER_SIZE = 72;

/** Billboard scale at 1x: the sprite is shown at about 29 px. */
export const GHOST_MARKER_DISPLAY_SCALE = 0.4;

/** The Cyber theme's accent, and a lighter tint for the glyph strokes. */
export const GHOST_MARKER_FRAME_COLOR = '#00d4ff';
export const GHOST_MARKER_GLYPH_COLOR = '#b6f4ff';
const PLATE_COLOR = 'rgba(4, 16, 22, 0.88)';

/**
 * Words that name a kind. The FIRST rule that matches wins, so the more
 * specific kinds (a missile, a drone) come before the general ones (a strike).
 * Matching is on whole words or word starts, case-insensitively.
 */
const KIND_RULES = Object.freeze([
  [
    'missile',
    /\b(missile|rocket|ballistic|cruise|atacms|himars|mlrs|katyusha|\bsam\b)/,
  ],
  ['drone', /\b(drone|uav|uas|loitering|shahed|quadcopter|kamikaze|fpv)/],
  [
    'air',
    /\b(air ?strike|air ?raid|air ?defen[cs]e|aircraft|fighter|helicopter|bomber|jet|sortie|aviation)/,
  ],
  [
    'naval',
    /\b(naval|warship|vessel|ship|boat|maritime|submarine|frigate|destroyer|tanker|carrier|sea)\b/,
  ],
  [
    'strike',
    /\b(explos|blast|ied|vbied|bomb|shell|artillery|mortar|detonat|kinetic|strike|attack|assault|shoot|clash|raid)/,
  ],
  [
    'clash',
    /\b(firefight|battle|combat|ambush|skirmish|engagement|gunfire|armed|fighting|offensive|front ?line|flot)/,
  ],
  ['fire', /\b(fire|arson|burn|wildfire|blaze|flame|inferno)/],
  [
    'casualty',
    /\b(casualt|killed|dead|death|wound|injur|fatal|victim|hospital|medical|massacre|mass grave|mortality)/,
  ],
  [
    'unrest',
    /\b(protest|riot|demonstr|unrest|rally|uprising|civil disorder|march(es)?)\b/,
  ],
  [
    'checkpoint',
    /\b(checkpoint|border|crossing|gate|barrier|roadblock|customs)/,
  ],
  ['displacement', /\b(displac|refugee|idp|camp|evacu|migrant|shelter|asylum)/],
  [
    'facility',
    /\b(base|facility|depot|headquarter|hq|compound|airfield|airbase|port|plant|refinery|power|bridge|infrastructure|garrison|barracks|warehouse|factory|dam|airport)/,
  ],
]);

/** Labels of a popup-table row whose VALUE names the kind of event. */
const TYPE_LABEL =
  '(?:event[ _]?type|incident[ _]?type|type|category|class(?:ification)?|sub[ _]?type|event)';

/**
 * The value of the first `Type`/`Category`-style row of an ArcGIS popup table.
 * Only that row is read; the rest of the description is not scanned.
 *
 * @param {string|null|undefined} html The placemark description.
 * @returns {string} The row's value, or ''.
 */
export function descriptionTypeText(html) {
  const text = String(html ?? '');
  if (!text) return '';
  const match = new RegExp(
    `<t[dh][^>]*>\\s*${TYPE_LABEL}\\s*</t[dh]>\\s*<t[dh][^>]*>([^<]{1,80})</t[dh]>`,
    'i',
  ).exec(text);
  return match ? match[1].trim() : '';
}

/**
 * The kind of one placemark.
 *
 * @param {{folder?: string|null, name?: string|null,
 *   iconHref?: string|null, description?: string|null}} placemark
 * @returns {string} One of GHOST_MARKER_KINDS.
 */
export function ghostEventKind({ folder, name, iconHref, description } = {}) {
  const icon = String(iconHref ?? '')
    .split(/[?#]/)[0]
    .split(/[\\/]/)
    .pop()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ');
  // The most specific text first: the row that says what it is, then the
  // placemark's own name, then its folder and icon.
  const haystacks = [
    descriptionTypeText(description),
    String(name ?? ''),
    String(folder ?? ''),
    icon,
  ]
    .map((value) => value.toLowerCase().replace(/[_-]+/g, ' '))
    .filter(Boolean);
  for (const haystack of haystacks) {
    for (const [kind, pattern] of KIND_RULES) {
      if (pattern.test(haystack)) return kind;
    }
  }
  return GHOST_MARKER_DEFAULT_KIND;
}

/** Glyph strokes in unit space (-1..1), one drawing function per kind. */
const GLYPHS = Object.freeze({
  missile(ctx, p) {
    p.line(0, -1, 0, 0.55);
    p.poly([
      [-0.38, -0.42],
      [0, -1],
      [0.38, -0.42],
    ]);
    p.line(0, 0.2, -0.48, 0.78);
    p.line(0, 0.2, 0.48, 0.78);
    p.line(0, 0.78, 0, 1);
  },
  drone(ctx, p) {
    p.line(-0.55, -0.55, 0.55, 0.55);
    p.line(0.55, -0.55, -0.55, 0.55);
    for (const [x, y] of [
      [-0.72, -0.72],
      [0.72, -0.72],
      [-0.72, 0.72],
      [0.72, 0.72],
    ])
      p.circle(x, y, 0.27);
    p.rect(-0.2, -0.2, 0.4, 0.4);
  },
  air(ctx, p) {
    p.poly([
      [0, -1],
      [0.2, -0.3],
      [1, 0.35],
      [1, 0.58],
      [0.2, 0.3],
      [0.15, 0.76],
      [0.45, 0.96],
      [-0.45, 0.96],
      [-0.15, 0.76],
      [-0.2, 0.3],
      [-1, 0.58],
      [-1, 0.35],
      [-0.2, -0.3],
    ]);
  },
  naval(ctx, p) {
    p.poly([
      [-1, 0.22],
      [1, 0.22],
      [0.66, 0.82],
      [-0.66, 0.82],
    ]);
    p.line(0, 0.22, 0, -0.95);
    p.poly([
      [0, -0.85],
      [0.58, -0.12],
      [0, -0.12],
    ]);
  },
  strike(ctx, p) {
    const pts = [];
    for (let i = 0; i < 16; i += 1) {
      const r = i % 2 === 0 ? 1 : 0.42;
      const a = -Math.PI / 2 + (i * Math.PI) / 8;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    p.poly(pts);
  },
  clash(ctx, p) {
    // Two crossed blades, each with a hilt guard at its lower end.
    p.line(-0.9, -0.9, 0.55, 0.55);
    p.line(0.9, -0.9, -0.55, 0.55);
    p.line(0.25, 0.85, 0.85, 0.25);
    p.line(-0.25, 0.85, -0.85, 0.25);
  },
  fire(ctx, p) {
    p.path((c, u, x0, y0) => {
      c.moveTo(x0, y0 - u);
      c.bezierCurveTo(
        x0 + 0.95 * u,
        y0 - 0.05 * u,
        x0 + 0.8 * u,
        y0 + 0.95 * u,
        x0,
        y0 + 0.95 * u,
      );
      c.bezierCurveTo(
        x0 - 0.8 * u,
        y0 + 0.95 * u,
        x0 - 0.95 * u,
        y0 - 0.05 * u,
        x0,
        y0 - u,
      );
      c.closePath();
      c.moveTo(x0, y0 + 0.05 * u);
      c.bezierCurveTo(
        x0 + 0.38 * u,
        y0 + 0.35 * u,
        x0 + 0.3 * u,
        y0 + 0.8 * u,
        x0,
        y0 + 0.8 * u,
      );
      c.bezierCurveTo(
        x0 - 0.3 * u,
        y0 + 0.8 * u,
        x0 - 0.38 * u,
        y0 + 0.35 * u,
        x0,
        y0 + 0.05 * u,
      );
    });
  },
  casualty(ctx, p) {
    p.poly([
      [-0.3, -1],
      [0.3, -1],
      [0.3, -0.3],
      [1, -0.3],
      [1, 0.3],
      [0.3, 0.3],
      [0.3, 1],
      [-0.3, 1],
      [-0.3, 0.3],
      [-1, 0.3],
      [-1, -0.3],
      [-0.3, -0.3],
    ]);
  },
  unrest(ctx, p) {
    for (const x of [-0.7, 0, 0.7]) {
      p.circle(x, x === 0 ? -0.62 : -0.38, 0.24);
      p.line(x, x === 0 ? -0.26 : -0.02, x, 0.78);
    }
    p.line(-1, 0.9, 1, 0.9);
  },
  checkpoint(ctx, p) {
    p.line(-0.85, -0.95, -0.85, 0.95);
    p.line(0.85, -0.95, 0.85, 0.95);
    p.line(-0.85, -0.35, 0.85, -0.35);
    p.line(-0.85, 0.25, 0.85, 0.25);
    p.line(-0.2, -0.35, -0.55, 0.25);
    p.line(0.45, -0.35, 0.1, 0.25);
  },
  displacement(ctx, p) {
    p.poly([
      [0, -0.92],
      [1, 0.82],
      [-1, 0.82],
    ]);
    p.poly([
      [-0.3, 0.82],
      [0, 0.12],
      [0.3, 0.82],
    ]);
  },
  facility(ctx, p) {
    p.poly([
      [-0.95, 0.85],
      [-0.95, -0.2],
      [-0.32, 0.2],
      [-0.32, -0.2],
      [0.32, 0.2],
      [0.32, -0.95],
      [0.95, -0.95],
      [0.95, 0.85],
    ]);
  },
  report(ctx, p) {
    p.poly([
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]);
    p.circle(0, 0, 0.2);
  },
});

/**
 * Trace the plate, frame and glyph for one kind on a 2D context. Pure
 * drawing: nothing here reads the DOM.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} kind One of GHOST_MARKER_KINDS.
 * @param {number} [size] Sprite edge in pixels.
 */
export function drawGhostMarker(ctx, kind, size = GHOST_MARKER_SIZE) {
  const c = size / 2;
  const half = size * 0.45;
  const cut = size * 0.14;
  const u = size * 0.24;
  // The plate: a square with its corners cut, like an instrument bezel.
  ctx.beginPath();
  ctx.moveTo(c - half + cut, c - half);
  ctx.lineTo(c + half - cut, c - half);
  ctx.lineTo(c + half, c - half + cut);
  ctx.lineTo(c + half, c + half - cut);
  ctx.lineTo(c + half - cut, c + half);
  ctx.lineTo(c - half + cut, c + half);
  ctx.lineTo(c - half, c + half - cut);
  ctx.lineTo(c - half, c - half + cut);
  ctx.closePath();
  ctx.fillStyle = PLATE_COLOR;
  ctx.fill();
  ctx.lineWidth = size * 0.045;
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = GHOST_MARKER_FRAME_COLOR;
  ctx.stroke();

  const pen = {
    line(x0, y0, x1, y1) {
      ctx.moveTo(c + x0 * u, c + y0 * u);
      ctx.lineTo(c + x1 * u, c + y1 * u);
    },
    poly(points) {
      points.forEach(([x, y], i) =>
        i === 0
          ? ctx.moveTo(c + x * u, c + y * u)
          : ctx.lineTo(c + x * u, c + y * u),
      );
      ctx.closePath();
    },
    circle(x, y, r) {
      ctx.moveTo(c + (x + r) * u, c + y * u);
      ctx.arc(c + x * u, c + y * u, r * u, 0, Math.PI * 2);
    },
    rect(x, y, w, h) {
      ctx.rect(c + x * u, c + y * u, w * u, h * u);
    },
    path(draw) {
      draw(ctx, u, c, c);
    },
  };
  ctx.beginPath();
  (GLYPHS[kind] || GLYPHS[GHOST_MARKER_DEFAULT_KIND])(ctx, pen);
  ctx.lineWidth = size * 0.05;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = GHOST_MARKER_GLYPH_COLOR;
  ctx.stroke();
}

const spriteCache = new Map();

/**
 * The shared sprite for a kind, as an image URL, drawn once.
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
