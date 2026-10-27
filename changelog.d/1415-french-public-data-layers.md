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
