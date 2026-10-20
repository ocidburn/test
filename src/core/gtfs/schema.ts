/**
 * The on-device timetable database. Upstream string ids are mapped to dense
 * integers at import so the big tables stay small: stop_times is about a
 * million rows of five integers.
 *
 * Bump SCHEMA_VERSION whenever this changes; an older database is then
 * re-imported instead of being queried with the wrong shape.
 */
export const SCHEMA_VERSION = 1;

export const CREATE_TABLES = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT) WITHOUT ROWID;
CREATE TABLE routes (
  route_idx INTEGER PRIMARY KEY,
  route_id TEXT NOT NULL,
  short_name TEXT NOT NULL,
  long_name TEXT,
  route_type INTEGER,
  color TEXT
);
CREATE TABLE stops (
  stop_idx INTEGER PRIMARY KEY,
  stop_id TEXT NOT NULL,
  code TEXT,
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL,
  lat REAL,
  lon REAL
);
CREATE TABLE services (service_idx INTEGER PRIMARY KEY, service_id TEXT NOT NULL);
-- days: bit 0 = Sunday … bit 6 = Saturday, matching Date#getUTCDay.
CREATE TABLE calendar (
  service_idx INTEGER PRIMARY KEY,
  days INTEGER NOT NULL,
  start_date INTEGER NOT NULL,
  end_date INTEGER NOT NULL
);
CREATE TABLE calendar_dates (
  date INTEGER NOT NULL,
  service_idx INTEGER NOT NULL,
  exception_type INTEGER NOT NULL,
  PRIMARY KEY (date, service_idx)
) WITHOUT ROWID;
-- points: Float32 pairs (lat, lon) in sequence order.
CREATE TABLE shapes (shape_idx INTEGER PRIMARY KEY, shape_id TEXT NOT NULL, points BLOB NOT NULL);
CREATE TABLE trips (
  trip_idx INTEGER PRIMARY KEY,
  trip_id TEXT NOT NULL,
  route_idx INTEGER NOT NULL,
  service_idx INTEGER NOT NULL,
  headsign TEXT,
  direction INTEGER,
  shape_idx INTEGER,
  brigade TEXT,
  vehicle_id TEXT,
  last_seq INTEGER
);
CREATE TABLE stop_times (
  trip_idx INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  stop_idx INTEGER NOT NULL,
  arr INTEGER NOT NULL,
  dep INTEGER NOT NULL,
  PRIMARY KEY (trip_idx, seq)
) WITHOUT ROWID;
CREATE TABLE stop_routes (
  stop_idx INTEGER NOT NULL,
  route_idx INTEGER NOT NULL,
  PRIMARY KEY (stop_idx, route_idx)
) WITHOUT ROWID;
`;

/** Built after the bulk load, which is much faster than maintaining them row by row. */
export const CREATE_INDEXES = `
CREATE INDEX stop_times_by_stop ON stop_times (stop_idx, dep);
CREATE INDEX stops_by_name ON stops (name_norm);
CREATE INDEX stops_by_id ON stops (stop_id);
CREATE INDEX trips_by_id ON trips (trip_id);
`;

export type MetaKey =
  | 'schema_version'
  | 'source_url'
  | 'source_name'
  | 'feed_start'
  | 'feed_end'
  | 'imported_at'
  | 'counts';
