import type { Db } from '../db';
import { distanceMeters } from '../geo';
import { compareLines, isTramLine } from '../lines';
import { normalizeSearch } from '../text';
import { addDays, DAY_SECONDS, serviceDayBaseMs, warsawDateKey, weekdayOf } from '../time/warsaw';
import { SCHEMA_VERSION } from './schema';

export type TimetableMeta = {
  schemaVersion: number;
  sourceUrl: string | null;
  sourceName: string | null;
  feedStart: number | null;
  feedEnd: number | null;
  importedAt: number | null;
  counts: Record<string, number> | null;
};

export const readMeta = async (db: Db): Promise<TimetableMeta> => {
  const rows = await db.all<{ key: string; value: string | null }>('SELECT key, value FROM meta');
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const num = (key: string) => (map.get(key) ? Number(map.get(key)) : null);
  return {
    schemaVersion: num('schema_version') ?? 0,
    sourceUrl: map.get('source_url') ?? null,
    sourceName: map.get('source_name') ?? null,
    feedStart: num('feed_start'),
    feedEnd: num('feed_end'),
    importedAt: num('imported_at'),
    counts: map.get('counts') ? JSON.parse(map.get('counts')!) : null,
  };
};

export const isCurrentSchema = (meta: TimetableMeta) => meta.schemaVersion === SCHEMA_VERSION;

export type LineRef = { name: string; tram: boolean; color: string | null };

/** `lines` is GROUP_CONCAT of "name:route_type" pairs; one string per line keeps them aligned. */
const toLineRefs = (lines: string | null): LineRef[] => {
  if (!lines) return [];
  const seen = new Map<string, LineRef>();
  for (const pair of lines.split(',')) {
    const separator = pair.lastIndexOf(':');
    const name = pair.slice(0, separator);
    if (!name || seen.has(name)) continue;
    const type = pair.slice(separator + 1);
    seen.set(name, { name, tram: isTramLine(name, type ? Number(type) : null), color: null });
  }
  return [...seen.values()].sort((a, b) => compareLines(a.name, b.name));
};

export type StopSearchResult = { name: string; posts: number; lines: LineRef[] };

/**
 * Stops by name. A Wrocław stop is several posts (one per direction or
 * platform) sharing a name, so results are grouped by name.
 */
export const searchStops = async (db: Db, query: string, limit = 30): Promise<StopSearchResult[]> => {
  const needle = normalizeSearch(query);
  if (!needle) return [];
  const rows = await db.all<{ name: string; posts: number; lines: string | null; prefix: number }>(
    `SELECT s.name AS name,
            COUNT(DISTINCT s.stop_idx) AS posts,
            GROUP_CONCAT(r.short_name || ':' || COALESCE(r.route_type, '')) AS lines,
            MAX(s.name_norm LIKE ? OR s.name_norm LIKE ?) AS prefix
       FROM stops s
       LEFT JOIN stop_routes sr ON sr.stop_idx = s.stop_idx
       LEFT JOIN routes r ON r.route_idx = sr.route_idx
      WHERE s.name_norm LIKE ?
      GROUP BY s.name
      ORDER BY prefix DESC, LENGTH(s.name), s.name
      LIMIT ?`,
    [`${needle}%`, `% ${needle}%`, `%${needle}%`, limit],
  );
  return rows.map((row) => ({ name: row.name, posts: row.posts, lines: toLineRefs(row.lines) }));
};

/** Stops by exact name, in the order asked, with their lines; names no longer in the timetable are dropped. */
export const stopsByNames = async (db: Db, names: string[]): Promise<StopSearchResult[]> => {
  if (!names.length) return [];
  const rows = await db.all<{ name: string; posts: number; lines: string | null }>(
    `SELECT s.name AS name,
            COUNT(DISTINCT s.stop_idx) AS posts,
            GROUP_CONCAT(r.short_name || ':' || COALESCE(r.route_type, '')) AS lines
       FROM stops s
       LEFT JOIN stop_routes sr ON sr.stop_idx = s.stop_idx
       LEFT JOIN routes r ON r.route_idx = sr.route_idx
      WHERE s.name IN (${names.map(() => '?').join(',')})
      GROUP BY s.name`,
    names,
  );
  const byName = new Map(rows.map((row) => [row.name, { name: row.name, posts: row.posts, lines: toLineRefs(row.lines) }]));
  return names.map((name) => byName.get(name)).filter((stop): stop is StopSearchResult => !!stop);
};

export type NearbyStop = StopSearchResult & { distanceMeters: number };

/**
 * Stops near a point, nearest first, by the distance to their closest post.
 * Only posts some line serves; a box of about ±radius is scanned, then
 * measured exactly.
 */
export const nearbyStops = async (
  db: Db,
  lat: number,
  lon: number,
  { radiusMeters = 800, limit = 8 }: { radiusMeters?: number; limit?: number } = {},
): Promise<NearbyStop[]> => {
  const dLat = radiusMeters / 111_320;
  const dLon = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
  const posts = await db.all<{ name: string; lat: number; lon: number }>(
    `SELECT name, lat, lon FROM stops
      WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
        AND stop_idx IN (SELECT stop_idx FROM stop_routes)`,
    [lat - dLat, lat + dLat, lon - dLon, lon + dLon],
  );
  const nearest = new Map<string, number>();
  for (const post of posts) {
    const meters = distanceMeters(lat, lon, post.lat, post.lon);
    if (meters > radiusMeters) continue;
    const known = nearest.get(post.name);
    if (known === undefined || meters < known) nearest.set(post.name, meters);
  }
  const names = [...nearest.entries()].sort((a, b) => a[1] - b[1]).slice(0, limit).map(([name]) => name);
  const stops = await stopsByNames(db, names);
  return stops.map((stop) => ({ ...stop, distanceMeters: Math.round(nearest.get(stop.name)!) }));
};

export type StopPost = { stopIdx: number; stopId: string; code: string | null; name: string; lat: number | null; lon: number | null };

export const getStopPosts = (db: Db, name: string) =>
  db.all<StopPost>(
    'SELECT stop_idx AS stopIdx, stop_id AS stopId, code, name, lat, lon FROM stops WHERE name = ? ORDER BY code, stop_id',
    [name],
  );

/** Which services run on a date: calendar weekdays and range, then calendar_dates exceptions. */
export const activeServices = async (db: Db, dateKey: number): Promise<number[]> => {
  const bit = 1 << weekdayOf(dateKey);
  const rows = await db.all<{ service_idx: number }>(
    `SELECT service_idx FROM calendar
      WHERE (days & ?) != 0 AND start_date <= ? AND end_date >= ?
        AND service_idx NOT IN (SELECT service_idx FROM calendar_dates WHERE date = ? AND exception_type = 2)
     UNION
     SELECT service_idx FROM calendar_dates WHERE date = ? AND exception_type = 1`,
    [bit, dateKey, dateKey, dateKey, dateKey],
  );
  return rows.map((row) => row.service_idx);
};

export type Departure = {
  /** Epoch ms of the scheduled departure. */
  at: number;
  line: string;
  tram: boolean;
  headsign: string | null;
  stopIdx: number;
  stopCode: string | null;
  tripIdx: number;
  tripId: string;
  /** The service day the trip belongs to (YYYYMMDD), not always today. */
  serviceDay: number;
};

/**
 * Scheduled departures from a set of posts, soonest first.
 *
 * Two service days can be running at once: a night trip timed 25:30 belongs
 * to yesterday's timetable but departs today. Arrivals at a trip's last stop
 * are not departures and are left out.
 */
export const getDepartures = async (
  db: Db,
  stopIdxs: number[],
  { now = Date.now(), windowMinutes = 120, limit = 60 }: { now?: number; windowMinutes?: number; limit?: number } = {},
): Promise<Departure[]> => {
  if (!stopIdxs.length) return [];
  const today = warsawDateKey(now);
  const days = [addDays(today, -1), today];
  const results: Departure[] = [];

  for (const day of days) {
    const base = serviceDayBaseMs(day);
    const from = Math.floor((now - base) / 1000) - 60;
    const to = from + windowMinutes * 60;
    if (to < 0 || from > 2 * DAY_SECONDS) continue;
    const services = await activeServices(db, day);
    if (!services.length) continue;

    const rows = await db.all<{
      dep: number;
      line: string;
      routeType: number | null;
      headsign: string | null;
      stopIdx: number;
      stopCode: string | null;
      tripIdx: number;
      tripId: string;
    }>(
      `SELECT st.dep AS dep, r.short_name AS line, r.route_type AS routeType, t.headsign AS headsign,
              st.stop_idx AS stopIdx, s.code AS stopCode, t.trip_idx AS tripIdx, t.trip_id AS tripId
         FROM stop_times st
         JOIN trips t ON t.trip_idx = st.trip_idx
         JOIN routes r ON r.route_idx = t.route_idx
         JOIN stops s ON s.stop_idx = st.stop_idx
        WHERE st.stop_idx IN (${stopIdxs.map(() => '?').join(',')})
          AND st.dep BETWEEN ? AND ?
          AND st.seq < t.last_seq
          AND t.service_idx IN (${services.map(() => '?').join(',')})
        ORDER BY st.dep
        LIMIT ?`,
      [...stopIdxs, Math.max(0, from), to, ...services, limit],
    );
    for (const row of rows) {
      results.push({
        at: base + row.dep * 1000,
        line: row.line,
        tram: isTramLine(row.line, row.routeType),
        headsign: row.headsign,
        stopIdx: row.stopIdx,
        stopCode: row.stopCode,
        tripIdx: row.tripIdx,
        tripId: row.tripId,
        serviceDay: day,
      });
    }
  }

  return results
    .filter((departure) => departure.at >= now - 60_000)
    .sort((a, b) => a.at - b.at)
    .slice(0, limit);
};
