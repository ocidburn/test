import type { Db } from '../db';
import { decodeShape } from '../geo';
import { stopsAlong } from '../realtime/route-match';
import type { ProfileStop, ProfileTrip, VariantProfile } from '../realtime/trip-match';
import { addDays, warsawDateKey } from '../time/warsaw';
import { activeServices } from './queries';

/**
 * Build the timing profile of one route variant: the representative trip's
 * stops with their distance along the shape and their offsets from the run's
 * start, plus every run of the shape sorted by start time.
 *
 * The representative trip is the one on the shape with the most stops — the
 * others usually share its stop sequence. A run that starts partway along the
 * shape keeps its own start time; its small timing error is the same one the
 * original server accepts.
 */
export const getVariantProfile = async (
  db: Db,
  shapeIdx: number,
  line: string,
  headsign: string | null,
): Promise<VariantProfile | null> => {
  const shape = await db.first<{ points: Uint8Array }>('SELECT points FROM shapes WHERE shape_idx = ?', [shapeIdx]);
  if (!shape) return null;
  const points = decodeShape(shape.points);

  const rep = await db.first<{ tripIdx: number }>(
    `SELECT t.trip_idx AS tripIdx FROM trips t
      WHERE t.shape_idx = ?
      ORDER BY (SELECT COUNT(*) FROM stop_times st WHERE st.trip_idx = t.trip_idx) DESC
      LIMIT 1`,
    [shapeIdx],
  );
  if (!rep) return null;

  const rows = await db.all<{ stopIdx: number; name: string; code: string | null; lat: number; lon: number; seq: number; arr: number; dep: number }>(
    `SELECT s.stop_idx AS stopIdx, s.name AS name, s.code AS code, s.lat AS lat, s.lon AS lon, st.seq AS seq, st.arr AS arr, st.dep AS dep
       FROM stop_times st JOIN stops s ON s.stop_idx = st.stop_idx
      WHERE st.trip_idx = ? AND s.lat IS NOT NULL
      ORDER BY st.seq`,
    [rep.tripIdx],
  );
  if (rows.length < 2) return null;
  const firstDep = rows[0].dep;
  const withAlong = stopsAlong(points, rows);
  const stops: ProfileStop[] = withAlong.map((row) => ({
    stopIdx: row.stopIdx,
    name: row.name,
    code: row.code,
    lat: row.lat,
    lon: row.lon,
    seq: row.seq,
    alongMeters: row.along,
    arrivalOffset: row.arr - firstDep,
    departureOffset: row.dep - firstDep,
  }));

  const tripRows = await db.all<{ tripIdx: number; serviceIdx: number; startSeconds: number | null }>(
    `SELECT t.trip_idx AS tripIdx, t.service_idx AS serviceIdx,
            (SELECT st.dep FROM stop_times st WHERE st.trip_idx = t.trip_idx ORDER BY st.seq LIMIT 1) AS startSeconds
       FROM trips t WHERE t.shape_idx = ?`,
    [shapeIdx],
  );
  const trips: ProfileTrip[] = tripRows
    .filter((row): row is { tripIdx: number; serviceIdx: number; startSeconds: number } => row.startSeconds !== null && row.startSeconds >= 0)
    .map((row) => ({ tripIdx: row.tripIdx, serviceIdx: row.serviceIdx, startSeconds: row.startSeconds }))
    .sort((a, b) => a.startSeconds - b.startSeconds);

  const lengthMeters = stops.length ? stops[stops.length - 1].alongMeters : 0;
  return { shapeIdx, line, headsign, stops, trips, lengthMeters };
};

/**
 * Which services run today and yesterday (for night runs), as a lookup the
 * trip matcher calls per candidate. Built once per poll.
 */
export const buildActiveOn = async (
  db: Db,
  now: number,
): Promise<(serviceIdx: number, dateKey: number) => boolean> => {
  const todayKey = warsawDateKey(now);
  const yesterdayKey = addDays(todayKey, -1);
  const [today, yesterday] = await Promise.all([activeServices(db, todayKey), activeServices(db, yesterdayKey)]);
  const todaySet = new Set(today);
  const yesterdaySet = new Set(yesterday);
  return (serviceIdx, dateKey) => (dateKey === todayKey ? todaySet : yesterdaySet).has(serviceIdx);
};
