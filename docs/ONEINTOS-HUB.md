# OneIntOS hub layers

God's Eye View can show data from a local OneIntOS instance (a separate, private project) next to its public feeds. Only data that needs history, correlation, agent access, a server-held credential or a visibility policy goes through OneIntOS; public keyless feeds stay direct.

| Piece | Where |
| --- | --- |
| Same-origin proxy (`GET /api/hub/layers`, `/layers/{id}/features`, `/layers/{id}/stream`) | `server/providers/hub.js` |
| Portable client (list, features, SSE subscribe) | `src/layers/hub/source.js` |
| Strict normalizer for untrusted payloads | `src/layers/hub/records.js` |
| Station layer (`hub-stations`) | `src/layers/hub/index.js` |

Rules the code enforces, each with a test:

- **The browser never sees the token or the OneIntOS address.** `ONEINTOS_LAYERS_URL` must be a plain loopback http origin; the bearer token is added server-side. Unset or invalid values turn the hub off (503).
- **Same-site guard** on every `/api/hub/*` route, GET only, a path and query allowlist, bounded bodies, at most 4 open streams, and the browser's `Origin` and `Cookie` headers never reach OneIntOS.
- **Data is untrusted.** Payloads are normalized to known fields with bounded, control-free strings; a collection that does not state its origin is not shown. The hub layer family contains no HTML-injecting API (`src/layers/hub/noInnerHtml.test.mjs`); labels go through the world-overlay host.
- **The origin is always visible:** the layer panel and every station label say LIVE, SIMULATED or REPLAYED.
- **Positions are approximate.** The map shows a ring the size of the rounding applied by OneIntOS.

Configuration (server environment only; placeholders are in `.env.example`): `ONEINTOS_LAYERS_URL`, `ONEINTOS_LAYERS_TOKEN`.


## Station card spike (freshness work)

Question: can the world overlay's `card` variant show a station's readings as multi-line text through `textContent`?

Findings (pinned by `src/layers/hub/overlayCardSpike.test.mjs`):

- The overlay takes `title` plus `details: string[]`, one painted line per entry, and normalises every line to a string.
- It paints on a canvas with `ctx.fillText`. Text never reaches the DOM, so there is no markup path, but it is **not** `textContent`: the only `textContent` in the overlay is the accessibility button mirror, one short label per actionable card.
- There is no wrapping and no truncation: one long line makes a very wide card, so a caller must clip its own lines.
- A card is reachable by `hitTestWorldOverlay` rectangles and the accessibility button mirror. Canvas text cannot be selected or read by assistive technology.
- Click handling in other layers is a layer-owned `Cesium.ScreenSpaceEventHandler` on the scene canvas, `scene.pick`, `pickRegistry` (`resolvePickId`, `registerPickOwner`, `isOwnedByOtherLayer`) and `inputOwnership.isPointerFree`.

Decision rule (approved): use the overlay only if it supports multi-line text via `textContent`. It supports multi-line text but through canvas painting, so the card is a **dedicated DOM panel** built with `createElement` and `textContent`. It also wraps long values, can be read by assistive technology, and updates in place.
