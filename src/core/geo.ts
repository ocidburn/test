/**
 * Plane geometry on a local equirectangular projection — accurate to well
 * under a metre across a city, and much cheaper than great-circle maths.
 */

const EARTH_RADIUS_M = 6_371_000;
const RAD = Math.PI / 180;

export type LatLon = { lat: number; lon: number };

export const distanceMeters = (aLat: number, aLon: number, bLat: number, bLon: number): number => {
  const x = (bLon - aLon) * RAD * Math.cos(((aLat + bLat) / 2) * RAD);
  const y = (bLat - aLat) * RAD;
  return Math.sqrt(x * x + y * y) * EARTH_RADIUS_M;
};

/** Compass bearing from a to b, 0..360 (0 = north). */
export const bearingDegrees = (aLat: number, aLon: number, bLat: number, bLon: number): number => {
  const x = (bLon - aLon) * Math.cos(((aLat + bLat) / 2) * RAD);
  const y = bLat - aLat;
  const degrees = Math.atan2(x, y) / RAD;
  return (degrees + 360) % 360;
};

/** Smallest angle between two bearings, 0..180. */
export const angleBetween = (a: number, b: number): number => {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
};

/** Decode a shape blob: Float32 (lat, lon) pairs. */
export const decodeShape = (blob: Uint8Array): LatLon[] => {
  // Copy into a fresh buffer: the blob may be a view into a larger, unaligned
  // one (and Node's Buffer#slice does not copy).
  const floats = new Float32Array(new Uint8Array(blob).buffer, 0, Math.floor(blob.length / 4));
  const points: LatLon[] = [];
  for (let index = 0; index + 1 < floats.length; index += 2) points.push({ lat: floats[index], lon: floats[index + 1] });
  return points;
};

export type Projection = {
  /** Distance from the point to the polyline, metres. */
  distance: number;
  /** Distance along the polyline to the projected point, metres. */
  along: number;
  /** Bearing of the segment the point projects onto. */
  bearing: number;
  segment: number;
};

/**
 * Project a point onto a polyline: nearest segment, distance, position along
 * it. Segments before `fromSegment` are not candidates (but still count
 * towards `along`), so ordered points can be projected in order.
 */
export const projectOnPolyline = (points: LatLon[], lat: number, lon: number, fromSegment = 0): Projection | null => {
  if (points.length < 2) return null;
  const cosLat = Math.cos(lat * RAD);
  const toXY = (p: LatLon) => [(p.lon - lon) * RAD * cosLat * EARTH_RADIUS_M, (p.lat - lat) * RAD * EARTH_RADIUS_M];

  let best: Projection | null = null;
  let along = 0;
  let [ax, ay] = toXY(points[0]);
  for (let index = 1; index < points.length; index += 1) {
    const [bx, by] = toXY(points[index]);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const length = Math.sqrt(lengthSq);
    // The vehicle is at the origin; t is where its foot falls on segment a→b.
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const distance = Math.sqrt(px * px + py * py);
    if (index - 1 >= fromSegment && (!best || distance < best.distance)) {
      best = {
        distance,
        along: along + t * length,
        bearing: ((Math.atan2(dx, dy) / RAD) + 360) % 360,
        segment: index - 1,
      };
    }
    along += length;
    ax = bx;
    ay = by;
  }
  return best;
};

export type BBox = { minLat: number; maxLat: number; minLon: number; maxLon: number };

export const inBBox = (box: BBox, lat: number, lon: number) =>
  lat >= box.minLat && lat <= box.maxLat && lon >= box.minLon && lon <= box.maxLon;
