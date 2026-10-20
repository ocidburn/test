import { bearingDegrees, distanceMeters } from '../geo';
import type { FetchLike } from '../net/http';
import { fetchKlosok, type TripResolver } from './klosok';
import { fetchMpk, type Encoding, type LineSets } from './mpk';
import { fetchOpenData, mergeWithOpenData } from './open-data';
import { emptyStatus, type LiveVehicle, type SourceStatus } from './types';

/** A Kłosok bus this close to a same-line Wrocław record is the same bus. */
const KLOSOK_DEDUPE_METERS = 300;
/** Movement below this is GPS noise, not a heading. */
const HEADING_MIN_METERS = 8;
/** MPK states no position time; its last answer is trusted this long. */
const MPK_STALE_MS = 60_000;
const OPEN_DATA_STALE_MS = 90_000;
const KLOSOK_STALE_MS = 90_000;

export type SourceName = 'mpk' | 'openData' | 'klosok';

export type LiveSnapshot = {
  vehicles: LiveVehicle[];
  at: number;
  status: Record<SourceName, SourceStatus>;
};

export type TrackerDeps = {
  lines: () => Promise<LineSets>;
  isTram: (line: string, hint?: string | null) => boolean;
  resolver: TripResolver;
  fetchImpl?: FetchLike;
  now?: () => number;
};

/**
 * Polls the three position feeds, each failing on its own, and combines
 * them: MPK is the backbone, Open Data adds side numbers and brigades,
 * Kłosok outranks both for its own buses. Headings come from the feed when
 * it has one, else from the vehicle's movement between polls.
 */
export class LiveTracker {
  readonly status: Record<SourceName, SourceStatus> = {
    mpk: emptyStatus(),
    openData: emptyStatus(),
    klosok: emptyStatus(),
  };
  private last: Record<SourceName, { vehicles: LiveVehicle[]; at: number } | null> = { mpk: null, openData: null, klosok: null };
  private encoding: Encoding | null = null;
  private readonly history = new Map<string, { lat: number; lon: number; heading: number | null; seen: number }>();
  private readonly now: () => number;

  constructor(private readonly deps: TrackerDeps) {
    this.now = deps.now ?? Date.now;
  }

  private async run(name: SourceName, task: () => Promise<LiveVehicle[]>) {
    const at = this.now();
    const status = this.status[name];
    status.at = at;
    try {
      const vehicles = await task();
      this.last[name] = { vehicles, at };
      Object.assign(status, { ok: true, count: vehicles.length, error: null, okAt: at });
    } catch (error) {
      Object.assign(status, { ok: false, error: (error as Error).message });
    }
  }

  private fresh(name: SourceName, maxAgeMs: number, now: number) {
    const last = this.last[name];
    if (!last || now - last.at > maxAgeMs) return [];
    return last.vehicles;
  }

  async poll(): Promise<LiveSnapshot> {
    const { fetchImpl, isTram, resolver } = this.deps;
    await Promise.all([
      this.run('mpk', async () => {
        const lines = await this.deps.lines();
        const result = await fetchMpk(lines, { preferred: this.encoding, fetchImpl, now: this.now(), isTram: (line, hint) => isTram(line, hint) });
        this.encoding = result.encoding;
        return result.vehicles;
      }),
      this.run('openData', () => fetchOpenData({ fetchImpl, now: this.now(), isTram: (line) => isTram(line) })),
      this.run('klosok', () => fetchKlosok(resolver, { fetchImpl, now: this.now() })),
    ]);
    return this.combine();
  }

  /** Merge whatever each source last returned, while it is still fresh. */
  combine(): LiveSnapshot {
    const now = this.now();
    const merged = mergeWithOpenData(this.fresh('mpk', MPK_STALE_MS, now), this.fresh('openData', OPEN_DATA_STALE_MS, now));
    const klosok = this.fresh('klosok', KLOSOK_STALE_MS, now);
    const vehicles = [
      ...merged.filter(
        (vehicle) =>
          !klosok.some(
            (k) => k.line === vehicle.line && distanceMeters(k.lat, k.lon, vehicle.lat, vehicle.lon) <= KLOSOK_DEDUPE_METERS,
          ),
      ),
      ...klosok,
    ].map((vehicle) => this.withHeading(vehicle, now));

    for (const [id, entry] of this.history) if (now - entry.seen > 300_000) this.history.delete(id);
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

const structuredCloneStatus = (status: Record<SourceName, SourceStatus>) =>
  ({ mpk: { ...status.mpk }, openData: { ...status.openData }, klosok: { ...status.klosok } }) as Record<SourceName, SourceStatus>;
