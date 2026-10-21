import { bearingDegrees, distanceMeters } from '../geo';
import type { FetchLike, RequestOptions } from '../net/http';
import { impkUrl, parseImpkPositions } from './impk';
import { fetchKlosok, type TripResolver } from './klosok';
import { fetchMpk, type Encoding, type LineSets } from './mpk';
import { fetchOpenData, mergeWithOpenData } from './open-data';
import { emptyStatus, type LiveVehicle, type SourceDetail, type SourceStatus } from './types';

/** A Kłosok bus this close to a same-line Wrocław record is the same bus. */
const KLOSOK_DEDUPE_METERS = 300;
/** Movement below this is GPS noise, not a heading. */
const HEADING_MIN_METERS = 8;
export type SourceName = 'impk' | 'mpk' | 'openData' | 'klosok';

/**
 * How often each source is asked, and how long its last answer is trusted.
 * Open Data's table is large and its positions lag minutes behind, so once a
 * minute is plenty; MPK states no position time, so its answer ages fast.
 */
const SCHEDULE: Record<SourceName, { everyMs: number; staleMs: number }> = {
  impk: { everyMs: 0, staleMs: 60_000 },
  mpk: { everyMs: 0, staleMs: 60_000 },
  openData: { everyMs: 60_000, staleMs: 150_000 },
  klosok: { everyMs: 0, staleMs: 90_000 },
};

/**
 * While iMPK has answered this recently, MPK and Open Data are not asked:
 * iMPK has every MPK vehicle with its side number and delay. Shorter than
 * iMPK's own staleness, so they are back before its last answer expires.
 */
const IMPK_COVERS_MS = 30_000;

/** A failing source waits 30 s, then 60, 120 … up to 5 min before it is asked again. */
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 300_000;

export type LiveSnapshot = {
  vehicles: LiveVehicle[];
  at: number;
  status: Record<SourceName, SourceStatus>;
};

/** The user's iMPK login, when iMPK is switched on and filled in. */
export type ImpkClient = {
  url: string;
  session: { fetchText: (url: string, options?: RequestOptions) => Promise<string> };
};

export type TrackerDeps = {
  lines: () => Promise<LineSets>;
  isTram: (line: string, hint?: string | null) => boolean;
  resolver: TripResolver;
  fetchImpl?: FetchLike;
  now?: () => number;
  /** Null while iMPK is off. */
  impk?: () => Promise<ImpkClient | null>;
  /** Stop names by post symbol (GTFS stop_code), for iMPK's destinations. */
  stopNames?: () => Promise<Map<string, string>>;
  /** Bearing of the line's route towards `destination` (a post symbol) at a point; null when unknown. */
  routeHeading?: (line: string, destination: string, lat: number, lon: number) => Promise<number | null>;
};

/**
 * Polls the three position feeds, each failing on its own, and combines
 * them: MPK is the backbone, Open Data adds side numbers and brigades,
 * Kłosok outranks both for its own buses. Headings come from the feed when
 * it has one, else from the vehicle's movement between polls.
 */
export class LiveTracker {
  readonly status: Record<SourceName, SourceStatus> = {
    impk: emptyStatus(),
    mpk: emptyStatus(),
    openData: emptyStatus(),
    klosok: emptyStatus(),
  };
  private last: Record<SourceName, { vehicles: LiveVehicle[]; at: number } | null> = {
    impk: null,
    mpk: null,
    openData: null,
    klosok: null,
  };
  private encoding: Encoding | null = null;
  /** Per source: consecutive failures, and the earliest time to ask again. */
  private readonly pace: Record<SourceName, { failures: number; nextAt: number }> = {
    impk: { failures: 0, nextAt: 0 },
    mpk: { failures: 0, nextAt: 0 },
    openData: { failures: 0, nextAt: 0 },
    klosok: { failures: 0, nextAt: 0 },
  };
  private readonly history = new Map<string, { lat: number; lon: number; heading: number | null; seen: number }>();
  /** For vehicles that have not moved yet: the heading of the route they are on (iMPK names the destination). */
  private readonly routeHeadings = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly deps: TrackerDeps) {
    this.now = deps.now ?? Date.now;
  }

  private async run(name: SourceName, task: () => Promise<{ vehicles: LiveVehicle[]; detail?: SourceDetail }>) {
    const at = this.now();
    const pace = this.pace[name];
    this.status[name].idle = null;
    // Not due yet (its interval, or a pause after failures): keep the last answer.
    if (at < pace.nextAt) return;
    const status = this.status[name];
    status.at = at;
    try {
      const { vehicles, detail = null } = await task();
      this.last[name] = { vehicles, at };
      pace.failures = 0;
      pace.nextAt = at + SCHEDULE[name].everyMs;
      Object.assign(status, { ok: true, count: vehicles.length, error: null, okAt: at, detail, retryAt: null });
    } catch (error) {
      pace.failures += 1;
      pace.nextAt = at + Math.min(BACKOFF_BASE_MS * 2 ** (pace.failures - 1), BACKOFF_MAX_MS);
      Object.assign(status, { ok: false, error: (error as Error).message, retryAt: pace.nextAt });
    }
  }

  /** Not asked this round; a source switched off also takes its vehicles off the map. */
  private idle(name: SourceName, reason: 'off' | 'covered') {
    this.status[name].idle = reason;
    if (reason === 'off') {
      this.last[name] = null;
      Object.assign(this.status[name], { ok: false, count: 0, error: null, retryAt: null });
      this.pace[name] = { failures: 0, nextAt: 0 };
    }
  }

  private impkAnswered(now: number, withinMs: number) {
    const last = this.last.impk;
    return last !== null && now - last.at <= withinMs;
  }

  /** Route headings for the vehicles whose own movement has not given one yet. */
  private async headingsFromRoute(vehicles: LiveVehicle[], destinations: Map<string, string>) {
    const { routeHeading } = this.deps;
    if (!routeHeading) return;
    for (const vehicle of vehicles) {
      if (this.history.get(vehicle.id)?.heading != null) continue;
      const destination = destinations.get(vehicle.id);
      const heading = destination ? await routeHeading(vehicle.line, destination, vehicle.lat, vehicle.lon).catch(() => null) : null;
      if (heading === null) this.routeHeadings.delete(vehicle.id);
      else this.routeHeadings.set(vehicle.id, heading);
    }
  }

  private fresh(name: SourceName, maxAgeMs: number, now: number) {
    const last = this.last[name];
    if (!last || now - last.at > maxAgeMs) return [];
    return last.vehicles;
  }

  async poll(): Promise<LiveSnapshot> {
    const { fetchImpl, isTram, resolver } = this.deps;
    const impk = this.deps.impk ? await this.deps.impk().catch(() => null) : null;
    const covered = impk !== null && this.impkAnswered(this.now(), IMPK_COVERS_MS);
    if (!impk) this.idle('impk', 'off');
    if (covered) {
      this.idle('mpk', 'covered');
      this.idle('openData', 'covered');
    }
    await Promise.all([
      impk &&
        this.run('impk', async () => {
          const body = await impk.session.fetchText(impkUrl(impk.url, 'getPositions', { shortcut: 'true' }), { fetchImpl });
          const parsed = parseImpkPositions(body, { now: this.now(), isTram: (line, hint) => isTram(line, hint) });
          const names = this.deps.stopNames ? await this.deps.stopNames().catch(() => null) : null;
          await this.headingsFromRoute(parsed.vehicles, parsed.destinations);
          const vehicles = parsed.vehicles.map((vehicle) => {
            const destination = parsed.destinations.get(vehicle.id);
            const name = destination ? names?.get(destination) : undefined;
            return name ? { ...vehicle, headsign: name } : vehicle;
          });
          return { vehicles, detail: parsed.detail };
        }),
      !covered &&
        this.run('mpk', async () => {
          const lines = await this.deps.lines();
          const result = await fetchMpk(lines, { preferred: this.encoding, fetchImpl, now: this.now(), isTram: (line, hint) => isTram(line, hint) });
          this.encoding = result.encoding;
          return { vehicles: result.vehicles };
        }),
      !covered &&
        this.run('openData', async () => {
          const { vehicles, ...detail } = await fetchOpenData({ fetchImpl, now: this.now(), isTram: (line) => isTram(line) });
          return { vehicles, detail };
        }),
      this.run('klosok', async () => ({ vehicles: await fetchKlosok(resolver, { fetchImpl, now: this.now() }) })),
    ]);
    return this.combine();
  }

  /** Merge whatever each source last returned, while it is still fresh. */
  combine(): LiveSnapshot {
    const now = this.now();
    // iMPK, while its last answer is fresh, stands for MPK and Open Data together.
    const merged = this.impkAnswered(now, SCHEDULE.impk.staleMs)
      ? this.fresh('impk', SCHEDULE.impk.staleMs, now)
      : mergeWithOpenData(this.fresh('mpk', SCHEDULE.mpk.staleMs, now), this.fresh('openData', SCHEDULE.openData.staleMs, now));
    const klosok = this.fresh('klosok', SCHEDULE.klosok.staleMs, now);
    const vehicles = [
      ...merged.filter(
        (vehicle) =>
          !klosok.some(
            (k) => k.line === vehicle.line && distanceMeters(k.lat, k.lon, vehicle.lat, vehicle.lon) <= KLOSOK_DEDUPE_METERS,
          ),
      ),
      ...klosok,
    ].map((vehicle) => this.withHeading(vehicle, now));

    for (const [id, entry] of this.history) {
      if (now - entry.seen > 300_000) {
        this.history.delete(id);
        this.routeHeadings.delete(id);
      }
    }
    return { vehicles, at: now, status: structuredCloneStatus(this.status) };
  }

  private withHeading(vehicle: LiveVehicle, now: number): LiveVehicle {
    const previous = this.history.get(vehicle.id);
    let heading = vehicle.heading;
    if (heading === null && previous) {
      heading =
        distanceMeters(previous.lat, previous.lon, vehicle.lat, vehicle.lon) >= HEADING_MIN_METERS
          ? bearingDegrees(previous.lat, previous.lon, vehicle.lat, vehicle.lon)
          : previous.heading;
    }
    // Not moved yet: the route's own direction, when the feed says where it is going.
    if (heading === null) heading = this.routeHeadings.get(vehicle.id) ?? null;
    const moved = !previous || distanceMeters(previous.lat, previous.lon, vehicle.lat, vehicle.lon) >= HEADING_MIN_METERS;
    this.history.set(vehicle.id, {
      lat: moved ? vehicle.lat : previous!.lat,
      lon: moved ? vehicle.lon : previous!.lon,
      heading,
      seen: now,
    });
    return heading === vehicle.heading ? vehicle : { ...vehicle, heading };
  }
}

const structuredCloneStatus = (status: Record<SourceName, SourceStatus>): Record<SourceName, SourceStatus> => ({
  impk: { ...status.impk },
  mpk: { ...status.mpk },
  openData: { ...status.openData },
  klosok: { ...status.klosok },
});
