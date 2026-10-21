import type { Db } from '../db';
import { decodeShape, type BBox } from '../geo';
import { compareLines, isTramLine } from '../lines';
import type { TripResolver } from '../realtime/klosok';
import type { LineSets } from '../realtime/mpk';
import type { Variant } from '../realtime/route-match';

export type LineInfo = { name: string; tram: boolean; longName: string | null };

export const getLines = async (db: Db): Promise<LineInfo[]> => {
  const rows = await db.all<{ name: string; routeType: number | null; longName: string | null }>(
    'SELECT short_name AS name, MIN(route_type) AS routeType, MAX(long_name) AS longName FROM routes GROUP BY short_name',
  );
  return rows
    .map((row) => ({ name: row.name, tram: isTramLine(row.name, row.routeType), longName: row.longName }))
    .sort((a, b) => compareLines(a.name, b.name));
};

export const lineSets = (lines: LineInfo[]): LineSets => ({
  trams: lines.filter((line) => line.tram).map((line) => line.name),
  buses: lines.filter((line) => !line.tram).map((line) => line.name),
});

/** Every shape the line's trips use, with the headsign most of its trips carry. */
export const getVariants = async (db: Db, line: string): Promise<Variant[]> => {
  const rows = await db.all<{ shapeIdx: number; headsign: string | null; trips: number }>(
    `SELECT t.shape_idx AS shapeIdx, t.headsign AS headsign, COUNT(*) AS trips
       FROM trips t JOIN routes r ON r.route_idx = t.route_idx
      WHERE r.short_name = ? AND t.shape_idx IS NOT NULL
      GROUP BY t.shape_idx, t.headsign`,
    [line],
  );
  const byShape = new Map<number, { headsign: string | null; best: number; trips: number }>();
  for (const row of rows) {
    const entry = byShape.get(row.shapeIdx);
    if (!entry) byShape.set(row.shapeIdx, { headsign: row.headsign, best: row.trips, trips: row.trips });
    else {
      entry.trips += row.trips;
      if (row.trips > entry.best) Object.assign(entry, { headsign: row.headsign, best: row.trips });
    }
  }
  if (!byShape.size) return [];
  const shapes = await db.all<{ shapeIdx: number; points: Uint8Array }>(
    `SELECT shape_idx AS shapeIdx, points FROM shapes WHERE shape_idx IN (${[...byShape.keys()].map(() => '?').join(',')})`,
    [...byShape.keys()],
  );
  return shapes.map((shape) => {
    const meta = byShape.get(shape.shapeIdx)!;
    return { shapeIdx: shape.shapeIdx, headsign: meta.headsign, trips: meta.trips, points: decodeShape(shape.points) };
  });
};

export type RouteStop = { stopIdx: number; name: string; lat: number; lon: number; seq: number };

/** Stops of a variant, from its longest trip (some trips on a shape skip the first stops). */
export const getVariantStops = async (db: Db, shapeIdx: number): Promise<RouteStop[]> => {
  const trip = await db.first<{ tripIdx: number }>(
    `SELECT t.trip_idx AS tripIdx FROM trips t
      WHERE t.shape_idx = ?
      ORDER BY (SELECT COUNT(*) FROM stop_times st WHERE st.trip_idx = t.trip_idx) DESC
      LIMIT 1`,
    [shapeIdx],
  );
  if (!trip) return [];
  return db.all<RouteStop>(
    `SELECT s.stop_idx AS stopIdx, s.name AS name, s.lat AS lat, s.lon AS lon, st.seq AS seq
       FROM stop_times st JOIN stops s ON s.stop_idx = st.stop_idx
      WHERE st.trip_idx = ? AND s.lat IS NOT NULL
      ORDER BY st.seq`,
    [trip.tripIdx],
  );
};

export type MapStop = { stopIdx: number; name: string; code: string | null; lat: number; lon: number };

export const getStopsInBBox = (db: Db, box: BBox, limit = 400) =>
  db.all<MapStop>(
    `SELECT stop_idx AS stopIdx, name, code, lat, lon FROM stops
      WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
        AND stop_idx IN (SELECT stop_idx FROM stop_routes)
      LIMIT ?`,
    [box.minLat, box.maxLat, box.minLon, box.maxLon, limit],
  );

/** What Kłosok's trip and route ids mean in the installed timetable. */
/**
 * Post symbol (stop_code) of the last stop of each of a line's shapes: where
 * that variant is heading. One pass over the line's trips, then a primary-key
 * lookup per shape.
 */
export const getLineTermini = async (db: Db, line: string): Promise<Map<number, string>> => {
  const rows = await db.all<{ shapeIdx: number; code: string | null }>(
    `SELECT v.shape_idx AS shapeIdx,
            (SELECT s.code FROM stop_times st JOIN stops s ON s.stop_idx = st.stop_idx
              WHERE st.trip_idx = v.trip_idx ORDER BY st.seq DESC LIMIT 1) AS code
       FROM (SELECT t.shape_idx, MIN(t.trip_idx) AS trip_idx
               FROM trips t JOIN routes r ON r.route_idx = t.route_idx
              WHERE r.short_name = ? AND t.shape_idx IS NOT NULL
              GROUP BY t.shape_idx) v`,
    [line],
  );
  const termini = new Map<number, string>();
  for (const row of rows) if (row.code) termini.set(row.shapeIdx, String(row.code));
  return termini;
};

/** Stop names by post symbol (stop_code), as live feeds name their stops. */
export const getStopNamesByCode = async (db: Db): Promise<Map<string, string>> => {
  const rows = await db.all<{ code: string; name: string }>('SELECT code, name FROM stops WHERE code IS NOT NULL AND code <> \'\'');
  return new Map(rows.map((row) => [String(row.code), row.name]));
};

export const timetableResolver = (db: Db): TripResolver => {
  const lineCache = new Map<string, boolean>();
  return {
    byTripId: async (tripId) => {
      const row = await db.first<{ line: string; routeType: number | null; headsign: string | null }>(
        `SELECT r.short_name AS line, r.route_type AS routeType, t.headsign AS headsign
           FROM trips t JOIN routes r ON r.route_idx = t.route_idx WHERE t.trip_id = ?`,
        [tripId],
      );
      return row ? { line: row.line, tram: isTramLine(row.line, row.routeType), headsign: row.headsign } : null;
    },
    byRouteId: async (routeId) => {
      const row = await db.first<{ line: string; routeType: number | null }>(
        'SELECT short_name AS line, route_type AS routeType FROM routes WHERE route_id = ?',
        [routeId],
      );
      return row ? { line: row.line, tram: isTramLine(row.line, row.routeType) } : null;
    },
    hasLine: async (line) => {
      const cached = lineCache.get(line);
      if (cached !== undefined) return cached;
      const row = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM routes WHERE short_name = ?', [line]);
      const known = (row?.n ?? 0) > 0;
      lineCache.set(line, known);
      return known;
    },
  };
};
