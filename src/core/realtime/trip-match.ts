/**
 * Which scheduled run an MPK vehicle is on, and how late it is.
 *
 * Ported from wroclaw-mpk-map (MIT, © 2025 kijmoshi), commit b11fe19 —
 * server/src/progress.js. See NOTICE.
 *
 * MPK's live feed says only line, lat, lon — no trip id, no delay. Everything
 * here is inferred by putting the position back onto the GTFS geometry:
 *   1. the route variant (chosen by distance + heading elsewhere) gives the
 *      ordered stops;
 *   2. projecting the position onto the shape gives how far along it is;
 *   3. each stop carries its distance along the shape and its offset from the
 *      run's start, so the vehicle's progress interpolates to a time offset;
 *   4. the run is whichever of today's (or last night's) departures on this
 *      shape would put the vehicle exactly here now. The gap is the delay.
 *
 * An ETA is remaining scheduled running time from the real position; a delay
 * is how far off the timetable the run already is. Neither models traffic.
 */
import { DAY_SECONDS, serviceDayBaseMs, warsawParts } from '../time/warsaw';

export type ProfileStop = {
  stopIdx: number;
  name: string;
  code: string | null;
  lat: number;
  lon: number;
  seq: number;
  /** Distance along the shape, metres. */
  alongMeters: number;
  /** Seconds from the run's start. */
  arrivalOffset: number;
  departureOffset: number;
};

export type ProfileTrip = { tripIdx: number; serviceIdx: number; startSeconds: number };

/** One route variant: its stops with timing, and the day's runs that use it. */
export type VariantProfile = {
  shapeIdx: number;
  line: string;
  headsign: string | null;
  stops: ProfileStop[];
  /** Sorted ascending by `startSeconds`. */
  trips: ProfileTrip[];
  lengthMeters: number;
};

/**
 * Past this schedule gap the nearer explanation is a different departure, and
 * guessing produces a confident "18 min late" that is really the next tram on
 * time. Beyond it, no run is claimed.
 */
export const MAX_DELAY_SECONDS = 45 * 60;

/** Seconds into a run, given how far along the shape the vehicle has travelled. */
export const offsetAt = (stops: ProfileStop[], along: number): { offset: number; segmentIndex: number } => {
  const last = stops[stops.length - 1];
  if (along <= stops[0].alongMeters) return { offset: stops[0].arrivalOffset, segmentIndex: 0 };
  if (along >= last.alongMeters) return { offset: last.arrivalOffset, segmentIndex: -1 };

  // First stop whose alongMeters is >= along; interpolate between it and the previous.
  let low = 0;
  let high = stops.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (stops[mid].alongMeters < along) low = mid + 1;
    else high = mid;
  }
  const from = stops[low - 1];
  const to = stops[low];
  const span = to.alongMeters - from.alongMeters;
  const fraction = span > 0 ? (along - from.alongMeters) / span : 0;
  // From the departure of the stop behind to the arrival of the one ahead, so
  // a scheduled wait at a stop is not spread over the road on either side.
  return { offset: from.departureOffset + fraction * (to.arrivalOffset - from.departureOffset), segmentIndex: low - 1 };
};

const firstTripAtLeast = (trips: ProfileTrip[], startSeconds: number): number => {
  let low = 0;
  let high = trips.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (trips[mid].startSeconds < startSeconds) low = mid + 1;
    else high = mid;
  }
  return low;
};

export type RunMatch = { tripIdx: number; startSeconds: number; delaySeconds: number; dateKey: number };

/**
 * Which departure of this variant the vehicle is running, and by how much it
 * is off (positive = late). Runs that began yesterday are considered too: a
 * night service at 00:20 is a 24:20 departure on the previous service day.
 */
export const matchTrip = (
  profile: VariantProfile,
  progressOffset: number,
  now: number,
  activeOn: (serviceIdx: number, dateKey: number) => boolean,
): RunMatch | null => {
  const parts = warsawParts(now);
  const secondsOfDay = parts.hour * 3600 + parts.minute * 60 + parts.second;
  const yesterdayKey = ((d: number) => {
    const { year, month, day } = { year: Math.floor(d / 10000), month: Math.floor(d / 100) % 100, day: d % 100 };
    const date = new Date(Date.UTC(year, month - 1, day - 1));
    return date.getUTCFullYear() * 10_000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  })(parts.dateKey);

  const frames = [
    { seconds: secondsOfDay, dateKey: parts.dateKey },
    { seconds: secondsOfDay + DAY_SECONDS, dateKey: yesterdayKey },
  ];

  let best: RunMatch | null = null;
  for (const frame of frames) {
    const targetStart = frame.seconds - progressOffset;
    for (let i = firstTripAtLeast(profile.trips, targetStart - MAX_DELAY_SECONDS); i < profile.trips.length; i += 1) {
      const trip = profile.trips[i];
      if (trip.startSeconds - targetStart > MAX_DELAY_SECONDS) break;
      const delaySeconds = targetStart - trip.startSeconds;
      if (best && Math.abs(delaySeconds) >= Math.abs(best.delaySeconds)) continue;
      if (!activeOn(trip.serviceIdx, frame.dateKey)) continue;
      best = { tripIdx: trip.tripIdx, startSeconds: trip.startSeconds, delaySeconds: Math.round(delaySeconds), dateKey: frame.dateKey };
    }
  }
  return best;
};

export type UpcomingStop = {
  stopIdx: number;
  name: string;
  /** Remaining scheduled running time from the real position, seconds. */
  etaSeconds: number;
  /** Epoch ms the run is scheduled to reach the stop (start + offset on its service day). */
  scheduledAt: number | null;
};

export type RunDescription = {
  tripIdx: number;
  delaySeconds: number;
  headsign: string | null;
  /** The matched run's stops still ahead, soonest first. */
  nextStops: UpcomingStop[];
  nextStop: UpcomingStop | null;
  stopsAhead: number;
};

/**
 * Describe the run a vehicle at `along` metres is on: its delay and the stops
 * ahead with live ETAs. Null when no run matches (then only direction and
 * next-stop-by-geometry are known, which the caller already has).
 */
export const describeRun = (
  profile: VariantProfile,
  along: number,
  now: number,
  activeOn: (serviceIdx: number, dateKey: number) => boolean,
  { limit = 8 }: { limit?: number } = {},
): RunDescription | null => {
  const stops = profile.stops;
  const timed = stops.length > 1 && stops.every((s) => Number.isFinite(s.arrivalOffset) && Number.isFinite(s.departureOffset));
  if (!timed) return null;

  const { offset: progressOffset } = offsetAt(stops, along);
  const run = matchTrip(profile, progressOffset, now, activeOn);
  if (!run) return null;

  const base = serviceDayBaseMs(run.dateKey);
  let nextIndex = stops.findIndex((stop) => stop.alongMeters > along + 15);
  if (nextIndex === -1) nextIndex = stops.length;
  const upcoming = stops.slice(nextIndex, nextIndex + Math.max(limit, 0)).map((stop) => ({
    stopIdx: stop.stopIdx,
    name: stop.name,
    etaSeconds: Math.max(0, Math.round(stop.arrivalOffset - progressOffset)),
    scheduledAt: base + (run.startSeconds + stop.arrivalOffset) * 1000,
  }));

  return {
    tripIdx: run.tripIdx,
    delaySeconds: run.delaySeconds,
    headsign: profile.headsign,
    nextStops: upcoming,
    nextStop: upcoming[0] ?? null,
    stopsAhead: stops.length - nextIndex,
  };
};

/** Ring colour class for a delay: on time (< 2 min late), 2–5 min, over 5 min, or unknown. */
export type DelayStatus = 'ok' | 'mid' | 'late' | 'none';

export const delayStatus = (seconds: number | null | undefined): DelayStatus => {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return 'none';
  if (seconds < 120) return 'ok';
  if (seconds <= 300) return 'mid';
  return 'late';
};
