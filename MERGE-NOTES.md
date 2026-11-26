# Prep: merge upstream/main into the c3-data-sources branch (PR #1415)

Branch `prep/merge-upstream-main` = 36a1ea7 (PR head) + upstream/main (2ae043b),
merge in progress. **8 code conflicts left; the 14 locale JSON conflicts are already
resolved by key-union (upstream keys win, the branch's 192 own keys added back).**

## Already applied on top of the merge

- `changelog.d/1432-empty-env-does-not-shadow-dotenv.md` DELETED (upstream #1432 is
  Rohilalala/fix/b-vessel-course-north; ours collided with upstream's 1432 fragment).
  Upstream also reversed the empty-env rule on purpose (scripts/dev-fresh.sh: "an explicit
  empty string (the documented kill switch) is preserved"), so the branch's
  file-wins-over-empty-env dotenv fix is obsolete -> drop it with the fragment.
- `src/ui/localAdsbGuidanceI18n.test.mjs`: expectation aligned to upstream's meta-line rule
  ('RTL-SDR · WebUSB · connect a receiver in Radio', no 'ON · ' prefix).

## The 8 conflicts, with the resolution each needs

1. `server/standalone/vite.config.js` -> take UPSTREAM wholesale (`git checkout --theirs`).
   Upstream replaced the dotenv helpers with `applyEnvFiles` + `ENV_FILE_VALUES`
   (server/standalone/viteEnv.test.mjs). Then the branch's
   `src/tooling/viteBuild.test.mjs` (which imports dotenvFilesForMode / mergeDotenvIntoEnv /
   readDotenvFiles) must go too, or be re-pointed at applyEnvFiles. Both files are add/add
   vs upstream (upstream added its own src/tooling/viteBuild.test.mjs).
2. `src/app/constructCatalog.js` -> keep BOTH: upstream's
   `createApplicationAirQuality({ source, fieldSource })` AND the branch's four FR layers
   (vigicruesFloods, ignGeoplateforme, entsoeGrid, copernicusEms).
3. `src/firstRunExperience.test.mjs` -> pin is a serialized tool-schema length + sha256.
   Take upstream's side, then RECOMPUTE both numbers from the merged tree (run the test, read
   actual vs expected) and write the merged tree's values in.
4. `src/keySetupCore.test.mjs` -> keep BOTH hunks: the branch's platform-database tests and
   upstream's OpenAQ key-registry tests. (Merged src/keySetupCore.mjs already carries the
   'platform-database' key and upstream's ordering.)
5. `src/layers/ghostMaps/lifecycle.test.mjs` -> merge the import blocks: branch's marker
   constants (GHOST_DOT_SIZE_PX, GHOST_MARKER_DISPLAY_SCALE, GHOST_MARKER_SIZE,
   GHOST_SYMBOL_MAX_DISTANCE_M from './markers.js') + upstream's
   `import { setLocale } from '../../i18n/index.js'` and
   `import { createGhostMapsLayer, GHOSTMAPS_OVERLAY_SOURCE_ID } from './index.js'`.
6. `src/layers/transit/queries.js` -> keep BOTH hunks: the branch's i18n import +
   transitCountLabel() + stationModel import, and upstream's `displayMotion` import +
   MOTION_FIELD map; in the record literal keep upstream's key/route/operator/place/observedMs/
   motion AND the branch's name/shortCode/uic/segment, then keep the branch's station loop
   (src/layers/transit/stationModel.js + stations.js are branch-only and still present).
7. `src/ui/styles/cyber.css` -> upstream DELETED the file (Cyber HUD layout removed, sonar kept
   as a visual style) and moved layer glyphs into code. The branch's 5 added rules (ghostmaps
   '◬', vigicrues-floods '∿', ign-geoplateforme '⊞', entsoe-grid '⌁', copernicus-ems '⊕') must be
   re-homed into upstream's code-side glyph mechanism (see src/data/layerState.js,
   src/ui/layerNames.js) or dropped with the Cyber HUD.
8. `src/voice/actionSchemas.test.mjs` -> same golden-hash pin as (3): take upstream's side,
   then recompute length + sha256 from the merged tree.

## Then

- `npm ci && npm test` in the merged tree; fix the Realtime prompt budget
  (56927 > 56500 chars) by trimming the added tool schema - upstream's ceiling is the same
  56 500, so the branch's added tools must be shortened, not the ceiling raised.
- Commit the merge, push the branch to the fork, open/replace the upstream PR.

## Overlap to raise with the maintainer before pushing

upstream main already carries: transport.data.gouv.fr ODbL conditions (DATA_SOURCES.md),
ign-orthophotos-france.json library entry, the air-quality host-model field, and
RATP/Toulon/Montpellier/Bordeaux/Rouen/Le Havre/Tours GTFS feeds. Open upstream PR #1716
(asturksever) adds 306 transit feeds + a coverage heat-map, which overlaps the branch's transit
half. Only the four FR layers (vigicruesFloods, ignGeoplateforme, entsoeGrid,
copernicusEms) are still unique to the branch.

## Trigger nuance (measured, 2026-11-26 14:45Z)

Upstream DOES create `pull_request` runs for fork PRs: 7 runs repo-wide sit at
`action_required`, and fork PRs #1926/#1929 (both `mergeable_state=dirty`) carry runs
(45435727297, 45439389734, both created 2026-11-24). So "conflicting" is NOT a general
blocker for run creation.

What IS true for THIS PR: the current head (c89578e / 3347b7a / 37d4ebb / 0b615c0) has
`actions/runs?head_sha=...` total_count 0 and no check suite at all - no run was ever created
for those heads. So today there is nothing on the PR for a maintainer to approve, whichever
mechanism suppresses it (a fork PR whose head was closed+reopened, or the merge ref being
unavailable now that upstream/main is 1198 commits ahead).

Practical consequence is unchanged: land upstream/main in the branch FIRST (this prep), push,
then upstream/maintainer approves the new run. If no run appears for the new head either, the
upstream maintainer has to push the branch into the upstream repo themselves (the pattern every
green upstream PR uses: head repo == bilawalsidhu/gods-eye-view, e.g. #1947
sameh/aq-rating-export, #1716 feat/transit-keyless-feeds) - a fork head can only ever wait
for approval.
