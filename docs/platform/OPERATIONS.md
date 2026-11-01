# Running the platform database

The platform is optional. Without `GEV_DATABASE_URL` God's Eye View runs
exactly as before and `/api/platform/health` answers `{configured:false}`.

## First start

1. Choose a password and put it in `.env`:

   ```
   GEV_DB_PASSWORD=<long random string>
   GEV_DATABASE_URL=postgres://gev:<same password>@postgres:5432/gev
   ```

   Use host `postgres` for the app inside compose. For commands you run on
   the host (migrations, `psql`) use `127.0.0.1` instead of `postgres`.
   The password has no default on purpose: an empty one stops the image from
   starting.

2. Start the database. It is in the `platform` profile, so a plain
   `docker compose up` never starts it:

   ```bash
   docker compose --profile platform up -d postgres
   ```

3. Apply the schema:

   ```bash
   npm run platform:migrate
   ```

   Safe to repeat. Applied migrations are skipped; an applied file that was
   edited is an error (add a new file instead).

4. Check it from the app: `GET /api/platform/health` reports the server and
   PostGIS versions and whether migrations are current.

## Network

The database is published to `127.0.0.1:5432` only. Do not widen that.
If you need it from another machine, use an SSH tunnel rather than opening
the port. The health route is same-site only and never returns a connection
string.

## Backups

Run nightly (cron or a systemd timer):

```bash
GEV_BACKUP_DIR=/mnt/backup/gev npm run platform:backup
```

It writes a compressed custom-format dump and a checksum, verifies the dump
can be listed, and prunes files older than `GEV_BACKUP_KEEP_DAYS` (30).
Point `GEV_BACKUP_DIR` at a **second disk**, then copy it off-site.

Prove restores work, at least monthly:

```bash
GEV_BACKUP_DIR=/mnt/backup/gev npm run platform:restore-test
```

It checks the checksum, restores the newest dump into a scratch database,
confirms the schema and ontology are present, and drops the scratch database.
A backup you have never restored is not a backup.

For point-in-time recovery between dumps, enable WAL archiving later
(`archive_mode=on`, `archive_command` to the backup disk). Nightly dumps are
enough until the data is something you cannot afford to lose a day of.

## Upgrades

- Pin and review the image tag (`postgis/postgis:16-3.5`). A major Postgres
  upgrade needs a dump and restore into a new volume; do not change the tag
  across majors in place.
- After pulling new code, run `npm run platform:migrate` before restarting the
  app.

## Tests

`node --test server/platform/` runs without a database. To also run the test
that applies every migration to real PostGIS, point it at a throwaway
database:

```bash
GEV_TEST_DATABASE_URL=postgres://gev:...@127.0.0.1:5432/gev_test \
  node --test server/platform/
```

That test drops the `gev` schema in the database it is given. Never point it
at live data.
