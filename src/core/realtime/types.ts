export type VehicleSource = 'mpk' | 'merged' | 'open-data' | 'klosok';

/** One live vehicle, whichever feed it came from. */
export type LiveVehicle = {
  /** Stable across polls for the same physical vehicle. */
  id: string;
  /** Upper-case line name, matching routes.short_name. */
  line: string;
  tram: boolean;
  lat: number;
  lon: number;
  /** Compass bearing; from the feed when it has one, else from movement. Null when unknown. */
  heading: number | null;
  source: VehicleSource;
  /** Side number (numer boczny), when a feed states it. */
  vehicleNumber: string | null;
  brigade: string | null;
  /** Destination when a feed states it (Kłosok); otherwise worked out from the route. */
  headsign: string | null;
  tripId: string | null;
  /** Seconds late (negative: early), only when a feed publishes it. */
  delaySeconds: number | null;
  /** When the position was taken, epoch ms. MPK states no time: the moment it was fetched. */
  positionAt: number;
};

/** Anything outside this box is a bad fix, not a vehicle in the Wrocław area. */
export const AREA = { minLat: 50.8, maxLat: 51.5, minLon: 16.4, maxLon: 17.8 };

export const inArea = (lat: number, lon: number) =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  !(lat === 0 && lon === 0) &&
  lat >= AREA.minLat &&
  lat <= AREA.maxLat &&
  lon >= AREA.minLon &&
  lon <= AREA.maxLon;

export type SourceStatus = {
  ok: boolean;
  count: number;
  error: string | null;
  /** Last attempt, epoch ms. */
  at: number | null;
  /** Last success, epoch ms. */
  okAt: number | null;
  /** What the last answer contained and why rows were dropped, when the source can say. */
  detail: SourceDetail | null;
  /** After a failure: when the source will be asked again, epoch ms. */
  retryAt: number | null;
};

export type SourceDetail = {
  total: number;
  rejected: Partial<Record<string, number>>;
  clock?: 'warsaw' | 'utc';
  medianAgeSeconds?: number | null;
};

export const emptyStatus = (): SourceStatus => ({ ok: false, count: 0, error: null, at: null, okAt: null, detail: null, retryAt: null });
