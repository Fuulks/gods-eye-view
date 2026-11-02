# OneIntOS hub layers

God's Eye View can show data from a local OneIntOS instance (a separate, private project) next to its public feeds. Only data that needs history, correlation, agent access, a server-held credential or a visibility policy goes through OneIntOS; public keyless feeds stay direct.

| Piece | Where |
| --- | --- |
| Same-origin proxy (`GET /api/hub/layers`, `/layers/{id}/features`, `/layers/{id}/stream`) | `server/providers/hub.js` |
| Portable client (list, features, SSE subscribe) | `src/layers/hub/source.js` |
| Strict normalizer for untrusted payloads | `src/layers/hub/records.js` |
| Station layer (`hub-stations`) | `src/layers/hub/index.js` |
| Freshness model (effective age, NOT CURRENT, label, colour) | `src/layers/hub/freshness.js` |
| Station card (dedicated DOM panel, text only) | `src/layers/hub/card.js` |

Rules the code enforces, each with a test:

- **The browser never sees the token or the OneIntOS address.** `ONEINTOS_LAYERS_URL` must be a plain loopback http origin; the bearer token is added server-side. Unset or invalid values turn the hub off (503).
- **Same-site guard** on every `/api/hub/*` route, GET only, a path and query allowlist, bounded bodies, at most 4 open streams, and the browser's `Origin` and `Cookie` headers never reach OneIntOS.
- **Data is untrusted.** Payloads are normalized to known fields with bounded, control-free strings; a collection that does not state its origin is not shown. The hub layer family contains no HTML-injecting API (`src/layers/hub/noInnerHtml.test.mjs`); labels go through the world-overlay host.
- **The origin is always visible:** the layer panel and every station label say LIVE, SIMULATED or REPLAYED.
- **Positions are approximate.** The map shows a ring the size of the rounding applied by OneIntOS.

## Freshness

Each station says how recently the OneIntOS Station API took in data, measured on the OneIntOS server clock, not from the reading's own timestamps (simulated and replayed data carry scenario time). The layers API sends `freshness` (`fresh`, `stale`, `offline` or `unknown`), `age_s`, `last_ingest_at` and the thresholds for that layer, so this layer hardcodes none of them.

- **Effective age** is the hub's `age_s` plus the monotonic time since that answer arrived, so a station keeps ageing between polls. The state shown is the worse of the hub's status and the age-derived one.
- **Polling** stays every 5 s, also when the hub is down; the last stations stay drawn.
- **NOT CURRENT.** After 12 s without a successful poll the layer says so (layer text `NOT CURRENT · last poll HH:MM:SSZ`, labels `NOT CURRENT · <age>`); a "fresh" station is then drawn stale. A payload without freshness (an older API) is also NOT CURRENT. It is never shown as current.
- **Look.** Fresh keeps the origin colour; stale is dimmed and labelled `STALE <age>`; offline is grey and labelled `OFFLINE (no data for <duration>)`; the hub only knows that no new data arrived, so the wording never says the station or sensor is down. The origin label is always kept.
- **What this cannot tell.** If the layers API stops, only "no new data" is known; it cannot say the Station API is down. The layer shows NOT CURRENT in that case, and stale/offline when the hub itself reports them.
- Per-sensor freshness is deferred; freshness is per station.

## Station card

Click a station to open its card (a dedicated panel; the world overlay paints text on a canvas, so it is not used, see the spike below). It shows origin, freshness and effective age, last ingest and expected interval, per-sensor metric, value, unit and quality, observed and received times (UTC, with relative age) and delay, and that the position is approximate. It keeps updating while open and shows NOT CURRENT when the hub is unreachable. Everything is written with `createElement` and `textContent`.

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
