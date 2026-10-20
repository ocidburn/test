/**
 * PT KŁOSOK's suburban buses (911, 921, …) from its public GTFS-RT feed.
 *
 * Label and delay rules ported from wroclaw-mpk-map (MIT, © 2025 kijmoshi),
 * commit b11fe19 — server/src/klosok/realtime.js. See NOTICE.
 *
 * Kłosok publishes no timetable of its own: trip and route ids point into
 * the Wrocław GTFS. Its `speed` field carries nonsense values and is ignored.
 */
import { request, type FetchLike } from '../net/http';
import { decodeFeed, type RtTripUpdate, type RtVehiclePosition } from './gtfs-rt';
import { inArea, type LiveVehicle } from './types';

export const KLOSOK_URL = 'https://mapadlugoleka.klosok.eu/vehicle_positions.pb';

const MAX_AGE_MS = 90_000;
const FUTURE_SKEW_MS = 10_000;

/** Looks into the installed timetable; implemented over the database by the app. */
export type TripResolver = {
  byTripId(tripId: string): Promise<{ line: string; tram: boolean; headsign: string | null } | null>;
  byRouteId(routeId: string): Promise<{ line: string; tram: boolean } | null>;
  hasLine(line: string): Promise<boolean>;
};

/**
 * `9003/91112/KMINKOWA` is vehicle 9003, line 911 with brigade 12, towards
 * KMINKOWA; between runs it reads `9047/12144`. The line is only taken when
 * the timetable knows it, so another label format is never misread as a line.
 */
export const parseLabel = async (label: string | null, hasLine: (line: string) => Promise<boolean>) => {
  const empty = { vehicleNumber: null, line: null, brigade: null, destination: null };
  if (!label) return empty;
  const [vehicleNumber, middle, destination] = label.split('/');
  const base = { ...empty, vehicleNumber: vehicleNumber || null, destination: destination?.trim() || null };
  if (!middle || middle.length < 4) return base;
  const line = middle.slice(0, 3);
  const brigade = middle.slice(3);
  return (await hasLine(line)) ? { ...base, line, brigade } : base;
};

/** The trip update's own delay, else the next stop's, else the last stated one. Never invented. */
export const tripDelay = (vehicle: RtVehiclePosition, updates: RtTripUpdate[]): number | null => {
  const tripId = vehicle.trip?.tripId;
  if (!tripId) return null;
  const update =
    updates.find((u) => u.trip?.tripId === tripId && (!vehicle.trip?.startDate || u.trip.startDate === vehicle.trip.startDate)) ??
    updates.find((u) => u.trip?.tripId === tripId);
  if (!update) return null;
  if (update.delay !== null) return update.delay;
  const current = vehicle.currentStopSequence;
  const next =
    (current !== null ? update.stopTimeUpdates.find((s) => s.stopSequence !== null && s.stopSequence >= current) : undefined) ??
    [...update.stopTimeUpdates].reverse().find((s) => s.departureDelay !== null || s.arrivalDelay !== null);
  return next ? (next.departureDelay ?? next.arrivalDelay) : null;
};

export const parseKlosokFeed = async (
  buffer: Uint8Array,
  resolver: TripResolver,
  { now = Date.now() }: { now?: number } = {},
): Promise<LiveVehicle[]> => {
  const feed = decodeFeed(buffer);
  const vehicles: LiveVehicle[] = [];
  for (const raw of feed.vehicles) {
    const lat = raw.latitude ?? NaN;
    const lon = raw.longitude ?? NaN;
    if (!inArea(lat, lon) || raw.timestamp === null) continue;
    const positionAt = raw.timestamp * 1000;
    if (positionAt > now + FUTURE_SKEW_MS || positionAt < now - MAX_AGE_MS) continue;

    const label = await parseLabel(raw.vehicleLabel, (line) => resolver.hasLine(line));
    const byTrip = raw.trip?.tripId ? await resolver.byTripId(raw.trip.tripId) : null;
    const byRoute = !byTrip && raw.trip?.routeId ? await resolver.byRouteId(raw.trip.routeId) : null;
    const line = byTrip?.line ?? byRoute?.line ?? label.line;
    if (!line) continue;

    const bearing = raw.bearing;
    vehicles.push({
      id: `klosok:${raw.vehicleId ?? raw.entityId}`,
      line,
      tram: byTrip?.tram ?? byRoute?.tram ?? false,
      lat,
      lon,
      heading: bearing !== null && Number.isFinite(bearing) && bearing !== 0 ? ((bearing % 360) + 360) % 360 : null,
      source: 'klosok',
      vehicleNumber: label.vehicleNumber ?? raw.vehicleId,
      brigade: label.brigade,
      headsign: byTrip?.headsign ?? label.destination,
      tripId: byTrip ? raw.trip!.tripId : null,
      delaySeconds: tripDelay(raw, feed.tripUpdates),
      positionAt,
    });
  }
  return vehicles;
};

export const fetchKlosok = async (
  resolver: TripResolver,
  { fetchImpl, now = Date.now(), timeoutMs = 10_000 }: { fetchImpl?: FetchLike; now?: number; timeoutMs?: number } = {},
): Promise<LiveVehicle[]> => {
  const buffer = await request(KLOSOK_URL, async (response) => new Uint8Array(await response.arrayBuffer()), {
    timeoutMs,
    fetchImpl,
    headers: { Accept: 'application/x-protobuf, application/octet-stream' },
  });
  return parseKlosokFeed(buffer, resolver, { now });
};
