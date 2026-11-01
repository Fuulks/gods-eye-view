-- God's Eye View data platform: core schema (DRAFT for review, not applied).
--
-- Target: PostgreSQL 16 + PostGIS 3. Single owner today; the shape leaves room
-- for roles later (see ROADMAP.md, phase 7). When phase 0 starts this file is
-- split into numbered migrations under db/migrations/.
--
-- Design rules this file encodes:
--   1. The ontology is DATA. Object and link types live in tables, so adding
--      a type is an INSERT, not a schema migration.
--   2. History is append-only. An object's identity never changes; what is
--      known about it is a series of versioned states.
--   3. Every fact says where it came from: a source, an ingest run, a
--      confidence, and the raw payload it was read from.
--   4. High-volume readings (positions, sensor values) are observations in a
--      partitioned table, not states, so they cannot bloat the object tables.
--   5. Sensitivity is a column, not a convention. No `person` object type is
--      seeded (see ONTOLOGY.md, "Boundaries").

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- exclusion constraints on ranges
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy name matching

CREATE SCHEMA IF NOT EXISTS gev;
SET search_path = gev, public;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

-- Who may see a record. `private` data (your places, your notes) never leaves
-- the database through a shared export or a public share link.
CREATE TYPE sensitivity AS ENUM ('public', 'personal', 'private');

CREATE TYPE geometry_kind AS ENUM ('none', 'point', 'line', 'area', 'any');

CREATE TYPE merge_verdict AS ENUM ('same', 'different', 'undecided');

CREATE TYPE alert_status AS ENUM ('open', 'acknowledged', 'resolved', 'muted');

CREATE TYPE severity AS ENUM ('info', 'low', 'medium', 'high', 'critical');

-- ---------------------------------------------------------------------------
-- Sources and ingestion
-- ---------------------------------------------------------------------------

-- One row per upstream feed. Licence and terms travel with the data.
CREATE TABLE source (
  id              text PRIMARY KEY,                 -- 'firms', 'vigicrues'
  name            text NOT NULL,
  homepage        text,
  licence         text NOT NULL,                    -- 'ODbL', 'Etalab 2.0', ...
  attribution     text,                             -- shown wherever data appears
  terms_note      text,                             -- limits that matter to us
  trust           numeric(3,2) NOT NULL DEFAULT 0.50
                  CHECK (trust BETWEEN 0 AND 1),    -- prior, tuned over time
  refresh_seconds integer CHECK (refresh_seconds > 0),
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One row per connector execution. Lets you answer "what did we read, when,
-- and did it work" for any fact.
CREATE TABLE ingest_run (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id       text NOT NULL REFERENCES source (id),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  ok              boolean,
  http_status     integer,
  records_read    integer,
  records_written integer,
  error           text
);
CREATE INDEX ingest_run_source_time ON ingest_run (source_id, started_at DESC);

-- The payload exactly as received, so any state can be re-derived after a
-- parser fix. Bodies live on disk or object storage; the row keeps the hash.
CREATE TABLE raw_payload (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id          bigint NOT NULL REFERENCES ingest_run (id) ON DELETE CASCADE,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  content_type    text,
  sha256          bytea NOT NULL,
  bytes           integer NOT NULL,
  storage_uri     text NOT NULL,                    -- file:// or s3://
  UNIQUE (sha256, run_id)
);

-- ---------------------------------------------------------------------------
-- Ontology: the vocabulary, as data
-- ---------------------------------------------------------------------------

CREATE TABLE object_type (
  key             text PRIMARY KEY,                 -- 'place', 'event', ...
  label           text NOT NULL,
  description     text,
  geometry        geometry_kind NOT NULL DEFAULT 'any',
  -- JSON Schema for `props`. The loader validates writes against it.
  props_schema    jsonb NOT NULL DEFAULT '{"type":"object"}',
  default_sensitivity sensitivity NOT NULL DEFAULT 'public',
  -- Display hints for the globe: icon glyph, accent colour. Presentation only.
  presentation    jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE link_type (
  key             text PRIMARY KEY,                 -- 'located_in', 'affects'
  label           text NOT NULL,
  inverse_label   text,                             -- 'contains' for located_in
  from_type       text REFERENCES object_type (key),  -- NULL = any type
  to_type         text REFERENCES object_type (key),
  is_symmetric    boolean NOT NULL DEFAULT false,
  description     text
);

-- ---------------------------------------------------------------------------
-- Objects: identity, then versioned state
-- ---------------------------------------------------------------------------

-- Identity only. Nothing here changes after insert except retirement.
CREATE TABLE object (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_key        text NOT NULL REFERENCES object_type (key),
  sensitivity     sensitivity NOT NULL DEFAULT 'public',
  created_at      timestamptz NOT NULL DEFAULT now(),
  retired_at      timestamptz,                      -- soft delete, never DELETE
  merged_into     uuid REFERENCES object (id),      -- set by an accepted merge
  CHECK (merged_into IS NULL OR merged_into <> id)
);
CREATE INDEX object_type_idx ON object (type_key) WHERE retired_at IS NULL;

-- What a source calls the object. One object can carry many external ids; the
-- pair (source, key) is unique, which is what stops duplicate ingestion.
CREATE TABLE external_id (
  source_id       text NOT NULL REFERENCES source (id),
  external_key    text NOT NULL,
  object_id       uuid NOT NULL REFERENCES object (id),
  first_seen      timestamptz NOT NULL DEFAULT now(),
  last_seen       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, external_key)
);
CREATE INDEX external_id_object ON external_id (object_id);

-- Versioned state. Two time axes:
--   valid_during  when the thing was true in the world ("this flood warning
--                 was in force 06:00 to 18:00");
--   recorded_at / superseded_at  when WE knew it, so "what did the system
--                 believe at 09:00?" stays answerable after a correction.
CREATE TABLE object_state (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  object_id       uuid NOT NULL REFERENCES object (id),
  name            text,
  props           jsonb NOT NULL DEFAULT '{}',
  geom            geography(Geometry, 4326),
  valid_during    tstzrange NOT NULL DEFAULT tstzrange(now(), NULL),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  superseded_at   timestamptz,                      -- NULL = current belief
  source_id       text NOT NULL REFERENCES source (id),
  run_id          bigint REFERENCES ingest_run (id),
  payload_id      bigint REFERENCES raw_payload (id),
  confidence      numeric(3,2) NOT NULL DEFAULT 0.50
                  CHECK (confidence BETWEEN 0 AND 1),
  CHECK (superseded_at IS NULL OR superseded_at >= recorded_at),
  -- One source cannot assert two overlapping, still-current states.
  EXCLUDE USING gist (
    object_id WITH =, source_id WITH =, valid_during WITH &&
  ) WHERE (superseded_at IS NULL)
);
CREATE INDEX object_state_object ON object_state (object_id, recorded_at DESC);
CREATE INDEX object_state_geom ON object_state USING gist (geom)
  WHERE superseded_at IS NULL;
CREATE INDEX object_state_valid ON object_state USING gist (valid_during)
  WHERE superseded_at IS NULL;
CREATE INDEX object_state_props ON object_state USING gin (props jsonb_path_ops)
  WHERE superseded_at IS NULL;
CREATE INDEX object_state_name ON object_state USING gin (name gin_trgm_ops)
  WHERE superseded_at IS NULL;

-- The current picture, as the globe and the API read it: the most recent
-- unsuperseded state per object, by its most trusted source.
CREATE VIEW object_current AS
SELECT DISTINCT ON (s.object_id)
       o.id, o.type_key, o.sensitivity,
       s.name, s.props, s.geom, s.valid_during,
       s.source_id, s.confidence, s.recorded_at
FROM object o
JOIN object_state s ON s.object_id = o.id AND s.superseded_at IS NULL
WHERE o.retired_at IS NULL AND o.merged_into IS NULL
ORDER BY s.object_id, s.confidence DESC, s.recorded_at DESC;

-- ---------------------------------------------------------------------------
-- Observations: high-volume readings
-- ---------------------------------------------------------------------------

-- Vessel and aircraft positions, river levels, grid load, air quality. One row
-- per reading, partitioned by month so old months can be detached or dropped.
CREATE TABLE observation (
  object_id       uuid NOT NULL REFERENCES object (id),
  observed_at     timestamptz NOT NULL,
  metric          text NOT NULL,                    -- 'position', 'level_m'
  value_num       double precision,
  value_json      jsonb,
  geom            geography(Point, 4326),
  source_id       text NOT NULL REFERENCES source (id),
  run_id          bigint,
  PRIMARY KEY (object_id, metric, observed_at, source_id)
) PARTITION BY RANGE (observed_at);

CREATE INDEX observation_time ON observation USING brin (observed_at);
CREATE INDEX observation_geom ON observation USING gist (geom);

-- Partitions are created by a scheduled job; the first two exist from day one.
CREATE TABLE observation_default PARTITION OF observation DEFAULT;

-- ---------------------------------------------------------------------------
-- Links
-- ---------------------------------------------------------------------------

CREATE TABLE link (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type_key        text NOT NULL REFERENCES link_type (key),
  from_object     uuid NOT NULL REFERENCES object (id),
  to_object       uuid NOT NULL REFERENCES object (id),
  valid_during    tstzrange NOT NULL DEFAULT tstzrange(now(), NULL),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  superseded_at   timestamptz,
  source_id       text NOT NULL REFERENCES source (id),
  run_id          bigint REFERENCES ingest_run (id),
  asserted_by     text NOT NULL DEFAULT 'pipeline'
                  CHECK (asserted_by IN ('pipeline', 'rule', 'analyst')),
  confidence      numeric(3,2) NOT NULL DEFAULT 0.50
                  CHECK (confidence BETWEEN 0 AND 1),
  props           jsonb NOT NULL DEFAULT '{}',
  CHECK (from_object <> to_object)
);
CREATE INDEX link_from ON link (from_object, type_key) WHERE superseded_at IS NULL;
CREATE INDEX link_to ON link (to_object, type_key) WHERE superseded_at IS NULL;

-- ---------------------------------------------------------------------------
-- Identity resolution
-- ---------------------------------------------------------------------------

-- Every proposed or decided duplicate pair, with the reason, so a wrong merge
-- can be explained and undone.
CREATE TABLE merge_candidate (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  object_a        uuid NOT NULL REFERENCES object (id),
  object_b        uuid NOT NULL REFERENCES object (id),
  score           numeric(4,3) NOT NULL CHECK (score BETWEEN 0 AND 1),
  signals         jsonb NOT NULL,                   -- {name:0.9, dist_m:120, ...}
  verdict         merge_verdict NOT NULL DEFAULT 'undecided',
  decided_by      text CHECK (decided_by IN ('rule', 'analyst')),
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (object_a < object_b),                      -- one row per pair
  UNIQUE (object_a, object_b)
);

-- ---------------------------------------------------------------------------
-- Documents and notes
-- ---------------------------------------------------------------------------

CREATE TABLE document (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  mime_type       text,
  storage_uri     text NOT NULL,
  sha256          bytea NOT NULL UNIQUE,
  source_id       text REFERENCES source (id),
  sensitivity     sensitivity NOT NULL DEFAULT 'personal',
  extracted_text  text,
  added_at        timestamptz NOT NULL DEFAULT now(),
  search          tsvector GENERATED ALWAYS AS
                  (to_tsvector('simple', coalesce(title, '') || ' ' ||
                                         coalesce(extracted_text, ''))) STORED
);
CREATE INDEX document_search ON document USING gin (search);

-- Which objects a document mentions, and where in it.
CREATE TABLE document_mention (
  document_id     uuid NOT NULL REFERENCES document (id) ON DELETE CASCADE,
  object_id       uuid NOT NULL REFERENCES object (id),
  excerpt         text,
  confidence      numeric(3,2) NOT NULL DEFAULT 0.50,
  PRIMARY KEY (document_id, object_id)
);

CREATE TABLE note (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id       uuid REFERENCES object (id),
  investigation_id uuid,                            -- FK added below
  body_md         text NOT NULL,
  sensitivity     sensitivity NOT NULL DEFAULT 'private',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Investigations (boards)
-- ---------------------------------------------------------------------------

CREATE TABLE investigation (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  question        text,                             -- what you are trying to settle
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'closed', 'archived')),
  sensitivity     sensitivity NOT NULL DEFAULT 'private',
  created_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz
);
ALTER TABLE note
  ADD CONSTRAINT note_investigation_fk
  FOREIGN KEY (investigation_id) REFERENCES investigation (id) ON DELETE CASCADE;

CREATE TABLE investigation_item (
  investigation_id uuid NOT NULL REFERENCES investigation (id) ON DELETE CASCADE,
  object_id       uuid NOT NULL REFERENCES object (id),
  position        integer NOT NULL DEFAULT 0,
  role            text,                             -- 'subject', 'evidence'
  added_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (investigation_id, object_id)
);

-- ---------------------------------------------------------------------------
-- Watch zones, rules and alerts
-- ---------------------------------------------------------------------------

-- A watch zone is a place object plus a radius or an area; the object carries
-- the geometry, this row says how to watch it.
CREATE TABLE watch_zone (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id       uuid NOT NULL REFERENCES object (id),
  radius_m        integer CHECK (radius_m > 0),     -- NULL = use the area itself
  label           text NOT NULL,
  enabled         boolean NOT NULL DEFAULT true
);

CREATE TABLE notification_channel (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('ntfy', 'telegram', 'signal', 'email', 'inapp')),
  label           text NOT NULL,
  -- Reference to a secret held outside the database (.env key name, vault
  -- path). Credentials themselves are never stored here.
  secret_ref      text,
  enabled         boolean NOT NULL DEFAULT true
);

CREATE TABLE alert_rule (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  -- Declarative match, evaluated by the rules engine, e.g.
  -- {"type":"event","within_zone":"<zone id>","min_severity":"medium",
  --  "props":{"hazard":"flood"}}
  spec            jsonb NOT NULL,
  min_severity    severity NOT NULL DEFAULT 'medium',
  cooldown        interval NOT NULL DEFAULT '1 hour',
  channel_ids     uuid[] NOT NULL DEFAULT '{}',
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alert (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_id         uuid NOT NULL REFERENCES alert_rule (id),
  object_id       uuid REFERENCES object (id),      -- the thing that matched
  severity        severity NOT NULL,
  status          alert_status NOT NULL DEFAULT 'open',
  fired_at        timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at     timestamptz,
  explanation     jsonb NOT NULL,                   -- why it fired, with sources
  -- A rule must not re-fire for the same object inside its cooldown.
  dedupe_key      text NOT NULL,
  UNIQUE (rule_id, dedupe_key, fired_at)
);
CREATE INDEX alert_open ON alert (fired_at DESC) WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

-- Who read or changed what. Reads of `private` objects are logged too.
CREATE TABLE audit_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at              timestamptz NOT NULL DEFAULT now(),
  actor           text NOT NULL,                    -- 'owner', 'pipeline:firms'
  action          text NOT NULL,                    -- 'read', 'write', 'merge'
  target_kind     text NOT NULL,
  target_id       text,
  detail          jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_time ON audit_log (at DESC);

-- ---------------------------------------------------------------------------
-- Seed: the starter ontology
-- ---------------------------------------------------------------------------
-- Deliberately small. Every type below is something at least one existing
-- layer already produces. There is NO `person` type.

INSERT INTO object_type (key, label, description, geometry, default_sensitivity, presentation) VALUES
  ('place',          'Place',          'A location you care about: home, work, a route waypoint.', 'any',   'private', '{"glyph":"⌖"}'),
  ('event',          'Event',          'Something that happened or is in force: a fire, flood warning, quake, conflict report, outage.', 'any', 'public', '{"glyph":"◬"}'),
  ('sensor',         'Sensor',         'A fixed instrument: river gauge, air-quality station, webcam, receiver.', 'point', 'public', '{"glyph":"◉"}'),
  ('infrastructure', 'Infrastructure', 'A station, grid zone, port, airport, cable, dam.',        'any',   'public', '{"glyph":"⊞"}'),
  ('asset',          'Asset',          'A mobile thing tracked by public feeds: aircraft, vessel, train, bike-share fleet.', 'point', 'public', '{"glyph":"◇"}'),
  ('organisation',   'Organisation',   'An operator, agency or company that publishes or owns things.', 'none', 'public', '{}'),
  ('area',           'Area',           'A region: administrative boundary, warning zone, exclusion area.', 'area', 'public', '{}'),
  ('document',       'Document',       'A report or file, referenced from the document table.', 'none', 'personal', '{}');

INSERT INTO link_type (key, label, inverse_label, from_type, to_type, is_symmetric, description) VALUES
  ('located_in',   'is located in',  'contains',        NULL,    'area',           false, 'Containment, usually derived from geometry.'),
  ('near',         'is near',        'is near',         NULL,    NULL,             true,  'Within a stated distance; props.distance_m.'),
  ('affects',      'affects',        'is affected by',  'event', NULL,             false, 'An event touches a place, asset or piece of infrastructure.'),
  ('measured_by',  'is measured by', 'measures',        NULL,    'sensor',         false, 'A sensor reports on an object or area.'),
  ('operated_by',  'is operated by', 'operates',        NULL,    'organisation',   false, 'Who runs or publishes it.'),
  ('reported_by',  'was reported by','reported',        'event', 'document',       false, 'A document is the evidence for an event.'),
  ('derived_from', 'is derived from','derives',         NULL,    NULL,             false, 'An object was computed from another.'),
  ('same_as',      'is the same as', 'is the same as',  NULL,    NULL,             true,  'Accepted duplicate; mirrors a merge_candidate.');
