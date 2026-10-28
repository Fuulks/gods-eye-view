- Add four French public-data layers: VIGICRUES flood warnings and
  flood-warning zones, ENTSO-E European grid load, Copernicus EMS emergency
  activations, and the IGN Géoplateforme raster basemap. Each one fetches
  through a server-side proxy, so the browser never names an upstream URL,
  and each source's licence and attribution are recorded in
  DATA_SOURCES.md (Fuulks, #1415).
- Fold the French public data into the pre-existing rows instead of adding
  new ones: the Layers panel keeps one Transit row and one Bike Share row.
  The Transit row now draws the live GTFS-RT fleet AND the SNCF passenger-
  station network (2 792 stations, a static catalogue and not live train
  positions), and says so in its source line (GTFS-RT · SNCF). The Bike
  Share row gains Paris and the Vélib' network as one more GBFS city entry
  (1 519 stations with live bike, e-bike and free-dock availability), read
  through the same generic proxy every other city uses. The station
  catalogue is static, so it loads with the layer rather than following the
  fleet's camera-driven altitude gate (Fuulks, #1415).
- Give the French public-data rows the same visual grammar as the
  pre-existing layers, using only the three patterns the Layers panel
  already has: VIGICRUES becomes a legend of vigilance bands with live
  counts, the IGN row keeps its place and gains chips that switch the
  raster basemap, the Transit row gains chips that switch between the
  live fleet and the station network plus a legend of the rail segments,
  the Bike Share row shows the availability ramp every city in it is
  drawn in (Velib' included), and Copernicus EMS and ENTSO-E hand off to
  a rail card. The Transit row also splits its count into the two
  populations it draws, so a fleet of vehicles is never counted as
  stations (Fuulks, #1415).
- Every layer row now names the DATASET in its source line, never the
  operator: the operator and the licence stay in DATA_SOURCES.md and the
  in-app credits (Fuulks, #1415).
- A healthy layer row reads as three short segments — state, source, age —
  and the detail segment is reserved for a feed that is degraded, partial,
  stale or erroring (Fuulks, #1415).
- Known issue: the VIGICRUES station catalogue route answers 502 because the
  operator redirects /services/observations.json to /services/observations.json/index.php
  and the provider fetches it with redirect:'manual', so the 302 is treated as
  a failure. The warning-zone route, which carries the row's legend counts,
  is unaffected. The provider needs to follow the same-origin redirect the
  shared proxy already allows (Fuulks, #1415).
