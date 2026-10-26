- Add five French public-data layers: the SNCF passenger-station network,
  VIGICRUES flood warnings and flood-warning zones, ENTSO-E European grid
  load, Copernicus EMS emergency activations, and the IGN Géoplateforme raster
  basemap. Each one fetches through a server-side proxy, so the browser never
  names an upstream URL, and each source's licence and attribution are
  recorded in DATA_SOURCES.md (Fuulks, #1415).
