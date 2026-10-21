import type { Db } from '../core/db';
import { getLineTermini, getVariants } from '../core/gtfs/map-queries';
import { buildActiveOn, getVariantProfile } from '../core/gtfs/trip-queries';
import { headingFromRoute, matchVariant, type Variant } from '../core/realtime/route-match';
import { describeRun, type RunDescription, type VariantProfile } from '../core/realtime/trip-match';
import type { LiveVehicle } from '../core/realtime/types';

/**
 * Puts MPK vehicles — which carry no trip id or delay — onto a scheduled run,
 * for the map card and the live departure board. Variants and timing profiles
 * are cached across both; the cache is cleared when the timetable changes.
 */

const variantsByLine = new Map<string, Variant[]>();
const profileByShape = new Map<number, VariantProfile | null>();
const terminiByLine = new Map<string, Promise<Map<number, string>>>();

export const clearDescribeCache = () => {
  variantsByLine.clear();
  profileByShape.clear();
  terminiByLine.clear();
};

const variantsOf = async (db: Db, line: string): Promise<Variant[]> => {
  const cached = variantsByLine.get(line);
  if (cached) return cached;
  const variants = await getVariants(db, line);
  variantsByLine.set(line, variants);
  return variants;
};

const profileOf = async (db: Db, variant: Variant, line: string): Promise<VariantProfile | null> => {
  if (profileByShape.has(variant.shapeIdx)) return profileByShape.get(variant.shapeIdx)!;
  const profile = await getVariantProfile(db, variant.shapeIdx, line, variant.headsign);
  profileByShape.set(variant.shapeIdx, profile);
  return profile;
};

/** The heading of the line's route towards `destination` (a post symbol) at a point. */
export const routeHeading = async (db: Db, line: string, destination: string, lat: number, lon: number): Promise<number | null> => {
  const variants = await variantsOf(db, line);
  let termini = terminiByLine.get(line);
  if (!termini) {
    termini = getLineTermini(db, line);
    terminiByLine.set(line, termini);
  }
  const byShape = await termini;
  return headingFromRoute(
    variants.map((variant) => ({ ...variant, terminus: byShape.get(variant.shapeIdx) ?? null })),
    { lat, lon },
    destination,
  );
};

export type ActiveOn = (serviceIdx: number, dateKey: number) => boolean;
export { buildActiveOn };

export type VehicleDescription = { variant: Variant; along: number; run: RunDescription | null };

/** Match a vehicle to a variant and, when the timetable allows, to a run. */
export const describeVehicle = async (
  db: Db,
  vehicle: Pick<LiveVehicle, 'line' | 'lat' | 'lon' | 'heading' | 'positionAt'>,
  now: number,
  activeOn: ActiveOn,
  /** How many stops ahead to time; the selected vehicle's sheet wants all of them. */
  { limit }: { limit?: number } = {},
): Promise<VehicleDescription | null> => {
  const match = matchVariant(await variantsOf(db, vehicle.line), vehicle);
  if (!match) return null;
  const profile = await profileOf(db, match.variant, vehicle.line);
  const run = profile ? describeRun(profile, match.projection.along, now, activeOn, { positionAt: vehicle.positionAt, limit }) : null;
  return { variant: match.variant, along: match.projection.along, run };
};

export type StopLive = { delaySeconds: number | null; etaSeconds: number };

/**
 * Live ETAs to a set of posts, by the trip each tracked vehicle is running.
 * A schedule row can then show the real countdown for a trip that is actually
 * on the road. Only vehicles whose line serves the stop are matched.
 */
export const liveDelaysForStop = async (
  db: Db,
  stopIdxs: Set<number>,
  lines: Set<string>,
  vehicles: LiveVehicle[],
  now: number,
  activeOn: ActiveOn,
): Promise<Map<string, StopLive>> => {
  const byTrip = new Map<string, StopLive>();
  for (const vehicle of vehicles) {
    if (!lines.has(vehicle.line)) continue;
    const description = await describeVehicle(db, vehicle, now, activeOn);
    const run = description?.run;
    if (!run) continue;
    const ahead = run.nextStops.find((stop) => stopIdxs.has(stop.stopIdx));
    if (!ahead) continue;
    // A trip id keyed by index into the installed timetable; the board joins on it.
    byTrip.set(String(run.tripIdx), { delaySeconds: run.delaySeconds, etaSeconds: ahead.etaSeconds });
  }
  return byTrip;
};
