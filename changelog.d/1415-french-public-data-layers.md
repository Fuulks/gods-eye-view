- Add five French public-data layers: the SNCF passenger-station network,
  VIGICRUES flood warnings and flood-warning zones, ENTSO-E European grid
  load, Copernicus EMS emergency activations, and the IGN Géoplateforme raster
  basemap. Each one fetches through a server-side proxy, so the browser never
  names an upstream URL, and each source's licence and attribution are
  recorded in DATA_SOURCES.md (Fuulks, #1415).
- Add the Vélib' Stations layer: the Paris docked-bikeshare network
  (1 519 stations across Paris and the surrounding communes) with live
  bike, e-bike and free-dock availability per station, read from the
  operator's GBFS 2.x feed through the same server-side proxy the other
  French public-data layers use, so the browser never names an upstream
  URL. The feed needs no API key, and its Licence Ouverte attribution is
  recorded in DATA_SOURCES.md (Fuulks, #1415).
