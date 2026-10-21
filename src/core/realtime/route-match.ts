import { angleBetween, projectOnPolyline, type LatLon, type Projection } from '../geo';

export type Variant = {
  shapeIdx: number;
  headsign: string | null;
  points: LatLon[];
  /** How many trips use it: breaks ties towards the main variant. */
  trips: number;
};

/**
 * Both directions of a line run down the same street — tram tracks a few
 * metres apart — so the nearer variant is decided by GPS noise half the time.
 * The heading is therefore part of the score, graded by the cosine of the
 * angle so a noisy heading on a bend does not flip the answer.
 * (Approach from wroclaw-mpk-map, MIT commit b11fe19, invariant 17.)
 */
export const HEADING_PENALTY_METERS = 200;
export const MAX_OFF_ROUTE_METERS = 120;

/**
 * Distance along the variant to each stop. Each search starts at the
 * previous stop's segment, so a line that passes the same place twice keeps
 * its stops in order.
 */
export const stopsAlong = <S extends { lat: number; lon: number }>(points: LatLon[], stops: S[]): (S & { along: number })[] => {
  let from = 0;
  return stops.map((stop) => {
    const projection = projectOnPolyline(points, stop.lat, stop.lon, from);
    if (!projection) return { ...stop, along: 0 };
    from = projection.segment;
    return { ...stop, along: projection.along };
  });
};

/** The first stop still ahead of a vehicle at `along` metres (a few metres of slack for one at the stop). */
export const nextStop = <S extends { along: number }>(stops: S[], along: number): S | null =>
  stops.find((stop) => stop.along > along + 15) ?? null;

export type VariantMatch ={ variant: Variant; projection: Projection; score: number };

/**
 * The heading of a vehicle that has not moved yet, from the route it is on:
 * among the line's variants ending at `destination` (a post symbol), the
 * nearest one's bearing at the vehicle. Null when no such variant runs past
 * it — distance alone does not tell the two directions apart.
 */
export const headingFromRoute = (
  variants: (Variant & { terminus: string | null })[],
  vehicle: { lat: number; lon: number },
  destination: string,
): number | null => {
  let best: Projection | null = null;
  for (const variant of variants) {
    if (variant.terminus !== destination) continue;
    const projection = projectOnPolyline(variant.points, vehicle.lat, vehicle.lon);
    if (!projection || projection.distance > MAX_OFF_ROUTE_METERS) continue;
    if (!best || projection.distance < best.distance) best = projection;
  }
  return best ? best.bearing : null;
};

export const matchVariant = (
  variants: Variant[],
  vehicle: { lat: number; lon: number; heading: number | null },
): VariantMatch | null => {
  let best: VariantMatch | null = null;
  for (const variant of variants) {
    const projection = projectOnPolyline(variant.points, vehicle.lat, vehicle.lon);
    if (!projection || projection.distance > MAX_OFF_ROUTE_METERS) continue;
    const headingCost =
      vehicle.heading === null ? 0 : (HEADING_PENALTY_METERS * (1 - Math.cos((angleBetween(vehicle.heading, projection.bearing) * Math.PI) / 180))) / 2;
    // A tiny preference for well-used variants settles exact ties.
    const score = projection.distance + headingCost - Math.min(variant.trips, 100) * 0.01;
    if (!best || score < best.score) best = { variant, projection, score };
  }
  return best;
};
