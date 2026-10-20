import { transit_realtime as rt } from 'gtfs-realtime-bindings';

import { decodeFeed } from '../src/core/realtime/gtfs-rt';
import { parseKlosokFeed, parseLabel, type TripResolver } from '../src/core/realtime/klosok';
import { buildBody, fetchMpk, normalizeMpkRow } from '../src/core/realtime/mpk';
import { mergeWithOpenData, normalizeOpenDataRow, parseOpenDataRows, parseWarsawWallClock } from '../src/core/realtime/open-data';
import { matchVariant, nextStop, stopsAlong, type Variant } from '../src/core/realtime/route-match';
import { LiveTracker } from '../src/core/realtime/tracker';
import type { LiveVehicle } from '../src/core/realtime/types';

const NOW = Date.parse('2026-06-15T08:00:00+02:00');
const isTram = (line: string) => /^\d+$/.test(line) && Number(line) < 40;

const encodeFeed = (object: Record<string, unknown>) =>
  rt.FeedMessage.encode(rt.FeedMessage.fromObject(object)).finish();

const vehicle = (overrides: Partial<LiveVehicle>): LiveVehicle => ({
  id: 'mpk:4-1',
  line: '4',
  tram: true,
  lat: 51.11,
  lon: 17.03,
  heading: null,
  source: 'mpk',
  vehicleNumber: null,
  brigade: null,
  headsign: null,
  tripId: null,
  delaySeconds: null,
  positionAt: NOW,
  ...overrides,
});

const resolver: TripResolver = {
  byTripId: async (tripId) => (tripId === '3_911_1' ? { line: '911', tram: false, headsign: 'Długołęka' } : null),
  byRouteId: async (routeId) => (routeId === '921' ? { line: '921', tram: false } : null),
  hasLine: async (line) => ['911', '921', '931'].includes(line),
};

describe('MPK bus_position', () => {
  test('both body encodings; letter lines in both cases', () => {
    const lines = { trams: ['4'], buses: ['128', 'A'] };
    expect(decodeURIComponent(buildBody('typed', lines))).toBe(
      'busList[bus][]=128&busList[bus][]=A&busList[bus][]=a&busList[tram][]=4',
    );
    expect(decodeURIComponent(buildBody('flat', lines))).toBe('busList[][]=4&busList[][]=128&busList[][]=A&busList[][]=a');
  });

  test('x is latitude; letter lines upper-cased; bad fixes dropped', () => {
    expect(normalizeMpkRow({ x: 51.107, y: 17.038, name: 'a', k: 77, type: 'bus' }, { now: NOW, isTram })).toMatchObject({
      id: 'mpk:A-77',
      line: 'A',
      lat: 51.107,
      lon: 17.038,
      tram: false,
    });
    expect(normalizeMpkRow({ x: 0, y: 0, name: '4' }, { now: NOW, isTram })).toBeNull();
    expect(normalizeMpkRow({ x: 52.23, y: 21.0, name: '4' }, { now: NOW, isTram })).toBeNull();
    expect(normalizeMpkRow({ x: 51.1, y: 17.0, name: ' ' }, { now: NOW, isTram })).toBeNull();
  });

  test('an empty answer to one encoding falls through to the other', async () => {
    const bodies: string[] = [];
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body);
      bodies.push(body);
      const rows = body.includes('busList%5B%5D%5B%5D') ? [{ x: 51.1, y: 17.0, name: '4', k: 1 }, { x: 51.1, y: 17.0, name: 'a', k: 1 }, { x: 51.1, y: 17.0, name: 'A', k: 1 }] : [];
      return new Response(JSON.stringify(rows));
    });
    const result = await fetchMpk({ trams: ['4'], buses: ['A'] }, { fetchImpl, now: NOW, isTram });
    expect(result.encoding).toBe('flat');
    expect(result.vehicles.map((v) => v.id)).toEqual(['mpk:4-1', 'mpk:A-1']);
    // Remembered encoding goes first next time.
    bodies.length = 0;
    await fetchMpk({ trams: ['4'], buses: [] }, { fetchImpl, now: NOW, isTram, preferred: 'flat' });
    expect(bodies).toHaveLength(1);
  });

  test('both encodings failing is an error, not an empty map', async () => {
    const fetchImpl = jest.fn(async () => new Response('[]'));
    await expect(fetchMpk({ trams: ['4'], buses: [] }, { fetchImpl, now: NOW, isTram })).rejects.toThrow(/typed: empty list; flat: empty list/);
  });
});

describe('Open Data table 14', () => {
  test('a bare wall clock is Wrocław time, across DST', () => {
    expect(parseWarsawWallClock('2026-06-15 08:00:00')).toBe(Date.parse('2026-06-15T08:00:00+02:00'));
    expect(parseWarsawWallClock('2026-12-15T08:00:00.250')).toBe(Date.parse('2026-12-15T08:00:00.250+01:00'));
    expect(parseWarsawWallClock('2026-03-29 03:30:00')).toBe(Date.parse('2026-03-29T03:30:00+02:00'));
    expect(parseWarsawWallClock('2026-06-15T06:00:00Z')).toBe(Date.parse('2026-06-15T06:00:00Z'));
    expect(parseWarsawWallClock('2026-06-15 08:00:00+01:00')).toBe(Date.parse('2026-06-15T07:00:00Z'));
    expect(parseWarsawWallClock('yesterday')).toBeNull();
  });

  const row = (overrides: Record<string, unknown> = {}) => ({
    Nazwa_Linii: '4',
    Nr_Boczny: 3012,
    Brygada: '00407',
    Ostatnia_Pozycja_Szerokosc: 51.1101,
    Ostatnia_Pozycja_Dlugosc: 17.0301,
    Data_Aktualizacji: '2026-06-15 07:59:30',
    ...overrides,
  });

  test('normalises a row; stale, future, numberless and 0,0 rows are dropped', () => {
    expect(normalizeOpenDataRow(row(), { now: NOW, isTram })).toMatchObject({
      id: 'open-data:3012',
      vehicleNumber: '3012',
      brigade: '00407',
      positionAt: Date.parse('2026-06-15T07:59:30+02:00'),
    });
    expect(normalizeOpenDataRow(row({ Data_Aktualizacji: '2026-06-15 07:57:59' }), { now: NOW, isTram })).toBeNull();
    expect(normalizeOpenDataRow(row({ Data_Aktualizacji: '2026-06-15 08:00:30' }), { now: NOW, isTram })).toBeNull();
    expect(normalizeOpenDataRow(row({ Nr_Boczny: 0 }), { now: NOW, isTram })).toBeNull();
    expect(normalizeOpenDataRow(row({ Ostatnia_Pozycja_Szerokosc: 0, Ostatnia_Pozycja_Dlugosc: 0 }), { now: NOW, isTram })).toBeNull();
  });

  test('merge: nearest same-line vehicle gains the number; ambiguity and duplicates are respected', () => {
    const mpk = [
      vehicle({ id: 'mpk:4-1', lat: 51.11, lon: 17.03 }),
      vehicle({ id: 'mpk:4-2', lat: 51.2, lon: 17.2 }),
      vehicle({ id: 'mpk:4-3', lat: 51.2005, lon: 17.2 }),
    ];
    const od = [
      vehicle({ id: 'open-data:1', source: 'open-data', vehicleNumber: '1', brigade: '7', lat: 51.1101, lon: 17.0301 }),
      // Equidistant from 4-2 and 4-3: ambiguous, and within dedupe range — dropped.
      vehicle({ id: 'open-data:2', source: 'open-data', vehicleNumber: '2', lat: 51.20025, lon: 17.2 }),
      // Far from any line 4: shown on its own.
      vehicle({ id: 'open-data:3', source: 'open-data', vehicleNumber: '3', lat: 51.05, lon: 16.9 }),
    ];
    const merged = mergeWithOpenData(mpk, od);
    expect(merged.find((v) => v.id === 'mpk:4-1')).toMatchObject({ source: 'merged', vehicleNumber: '1', brigade: '7' });
    expect(merged.find((v) => v.id === 'mpk:4-2')?.vehicleNumber).toBeNull();
    expect(merged.map((v) => v.id).sort()).toEqual(['mpk:4-1', 'mpk:4-2', 'mpk:4-3', 'open-data:3']);
  });
});

describe('GTFS-RT decoder', () => {
  test('reads what the official encoder writes, including negative delays and Polish labels', () => {
    const buffer = encodeFeed({
      header: { gtfsRealtimeVersion: '2.0', timestamp: 1_781_503_200 },
      entity: [
        {
          id: 'e1',
          vehicle: {
            trip: { tripId: '3_911_1', routeId: '911', startDate: '20260615', directionId: 1 },
            position: { latitude: 51.18, longitude: 17.1, bearing: 135, speed: 31337 },
            currentStopSequence: 4,
            timestamp: 1_781_503_190,
            stopId: '1234',
            vehicle: { id: '9003', label: '9003/91112/KMINKOWA ŁĄKA' },
          },
        },
        { id: 'e2', tripUpdate: { trip: { tripId: '3_911_1', startDate: '20260615' }, delay: -45, stopTimeUpdate: [{ stopSequence: 5, arrival: { delay: 60 } }] } },
      ],
    });
    const feed = decodeFeed(buffer);
    expect(feed.timestamp).toBe(1_781_503_200);
    expect(feed.vehicles).toHaveLength(1);
    const [v] = feed.vehicles;
    expect(v).toMatchObject({
      entityId: 'e1',
      trip: { tripId: '3_911_1', routeId: '911', startDate: '20260615', directionId: 1 },
      bearing: 135,
      timestamp: 1_781_503_190,
      currentStopSequence: 4,
      stopId: '1234',
      vehicleId: '9003',
      vehicleLabel: '9003/91112/KMINKOWA ŁĄKA',
    });
    expect(v.latitude).toBeCloseTo(51.18, 5);
    expect(v.longitude).toBeCloseTo(17.1, 5);
    expect(feed.tripUpdates[0]).toMatchObject({ delay: -45, stopTimeUpdates: [{ stopSequence: 5, arrivalDelay: 60, departureDelay: null }] });
  });

  test('a truncated buffer throws instead of reading garbage', () => {
    const buffer = encodeFeed({ header: { gtfsRealtimeVersion: '2.0' }, entity: [{ id: 'x', vehicle: { vehicle: { id: 'long id here' } } }] });
    expect(() => decodeFeed(buffer.slice(0, buffer.length - 3))).toThrow(/truncated/);
  });
});

describe('Kłosok', () => {
  test('labels name vehicle, line, brigade and destination when the line exists', async () => {
    const has = (line: string) => resolver.hasLine(line);
    await expect(parseLabel('9003/91112/KMINKOWA', has)).resolves.toEqual({
      vehicleNumber: '9003',
      line: '911',
      brigade: '12',
      destination: 'KMINKOWA',
    });
    await expect(parseLabel('9047/12144', has)).resolves.toMatchObject({ vehicleNumber: '9047', line: null });
    await expect(parseLabel(null, has)).resolves.toMatchObject({ vehicleNumber: null });
  });

  test('trip id, then route id, then label decide the line; stale fixes are dropped', async () => {
    const seconds = Math.floor(NOW / 1000);
    const buffer = encodeFeed({
      header: { gtfsRealtimeVersion: '2.0', timestamp: seconds },
      entity: [
        { id: 'a', vehicle: { trip: { tripId: '3_911_1' }, position: { latitude: 51.18, longitude: 17.1, bearing: 90 }, timestamp: seconds - 5, vehicle: { id: '9003', label: '9003/91112/X' } } },
        { id: 'b', vehicle: { trip: { routeId: '921' }, position: { latitude: 51.19, longitude: 17.11 }, timestamp: seconds - 5, vehicle: { id: '9004' } } },
        { id: 'c', vehicle: { position: { latitude: 51.2, longitude: 17.12 }, timestamp: seconds - 5, vehicle: { id: '9005', label: '9005/93101/OSIEDLE' } } },
        { id: 'd', vehicle: { position: { latitude: 51.2, longitude: 17.12 }, timestamp: seconds - 600, vehicle: { id: '9006', label: '9006/93102' } } },
        { id: 'e', vehicle: { position: { latitude: 51.2, longitude: 17.12 }, timestamp: seconds - 5, vehicle: { id: '9007' } } },
        { id: 'u', tripUpdate: { trip: { tripId: '3_911_1' }, stopTimeUpdate: [{ stopSequence: 2, departure: { delay: 120 } }] } },
      ],
    });
    const vehicles = await parseKlosokFeed(buffer, resolver, { now: NOW });
    expect(vehicles.map((v) => [v.id, v.line, v.headsign, v.heading, v.delaySeconds])).toEqual([
      ['klosok:9003', '911', 'Długołęka', 90, 120],
      ['klosok:9004', '921', null, null, null],
      ['klosok:9005', '931', 'OSIEDLE', null, null],
    ]);
  });
});

describe('tracker', () => {
  const lines = async () => ({ trams: ['4'], buses: ['911'] });

  const makeFetch = (state: { mpk: unknown[] | Error; od: unknown[] | Error; klosok: Uint8Array | Error }) =>
    jest.fn(async (url: string) => {
      const pick = url.includes('bus_position') ? state.mpk : url.includes('hdb/db/14') ? state.od : state.klosok;
      if (pick instanceof Error) throw pick;
      if (pick instanceof Uint8Array) return new Response(new Uint8Array(pick).buffer);
      return new Response(JSON.stringify(url.includes('hdb') ? { dane: pick } : pick));
    });

  test('one source failing does not empty the map; heading comes from movement', async () => {
    let now = NOW;
    const state = {
      mpk: [{ x: 51.1, y: 17.03, name: '4', k: 9 }] as unknown[] | Error,
      od: new Error('portal down') as unknown[] | Error,
      klosok: encodeFeed({ header: { gtfsRealtimeVersion: '2.0' }, entity: [] }) as Uint8Array | Error,
    };
    const tracker = new LiveTracker({ lines, isTram, resolver, fetchImpl: makeFetch(state), now: () => now });
    let snapshot = await tracker.poll();
    expect(snapshot.vehicles).toHaveLength(1);
    expect(snapshot.vehicles[0].heading).toBeNull();
    expect(snapshot.status.openData).toMatchObject({ ok: false, error: 'portal down' });
    expect(snapshot.status.mpk).toMatchObject({ ok: true, count: 1 });

    // Moves ~110 m north-east.
    now += 10_000;
    state.mpk = [{ x: 51.1007, y: 17.031, name: '4', k: 9 }];
    snapshot = await tracker.poll();
    expect(snapshot.vehicles[0].heading).toBeGreaterThan(30);
    expect(snapshot.vehicles[0].heading).toBeLessThan(60);

    // Jitter of a metre keeps the heading.
    now += 10_000;
    state.mpk = [{ x: 51.10071, y: 17.031, name: '4', k: 9 }];
    const heading = snapshot.vehicles[0].heading;
    snapshot = await tracker.poll();
    expect(snapshot.vehicles[0].heading).toBe(heading);

    // MPK down: its last answer is served for a minute, then dropped.
    state.mpk = new Error('timeout');
    now += 30_000;
    expect((await tracker.poll()).vehicles).toHaveLength(1);
    now += 40_000;
    expect((await tracker.poll()).vehicles).toHaveLength(0);
  });

  test('a Kłosok bus replaces the same-line Wrocław record next to it', async () => {
    const seconds = Math.floor(NOW / 1000);
    const state = {
      mpk: [
        { x: 51.18, y: 17.1, name: '911', k: 1 },
        { x: 51.3, y: 17.3, name: '911', k: 2 },
      ] as unknown[] | Error,
      od: [] as unknown[] | Error,
      klosok: encodeFeed({
        header: { gtfsRealtimeVersion: '2.0' },
        entity: [{ id: 'a', vehicle: { trip: { tripId: '3_911_1' }, position: { latitude: 51.1805, longitude: 17.1 }, timestamp: seconds, vehicle: { id: '9003' } } }],
      }) as Uint8Array | Error,
    };
    const tracker = new LiveTracker({ lines, isTram, resolver, fetchImpl: makeFetch(state), now: () => NOW });
    const snapshot = await tracker.poll();
    expect(snapshot.vehicles.map((v) => v.id).sort()).toEqual(['klosok:9003', 'mpk:911-2']);
  });
});

describe('direction from route geometry', () => {
  // Two variants on the same street, opposite directions, 5 m apart.
  const east: Variant = { shapeIdx: 1, headsign: 'Biskupin', trips: 50, points: [{ lat: 51.1, lon: 17.0 }, { lat: 51.1, lon: 17.05 }] };
  const west: Variant = { shapeIdx: 2, headsign: 'Oporów', trips: 50, points: [{ lat: 51.10005, lon: 17.05 }, { lat: 51.10005, lon: 17.0 }] };

  test('heading decides between directions GPS cannot separate', () => {
    expect(matchVariant([east, west], { lat: 51.10004, lon: 17.02, heading: 95 })?.variant.headsign).toBe('Biskupin');
    expect(matchVariant([east, west], { lat: 51.1, lon: 17.02, heading: 268 })?.variant.headsign).toBe('Oporów');
  });

  test('far from every variant means no match', () => {
    expect(matchVariant([east, west], { lat: 51.11, lon: 17.02, heading: 90 })).toBeNull();
  });
});

describe('stops along a variant', () => {
  test('a loop keeps stops in order, and the next stop is the first one ahead', () => {
    // Out east along a street and back on the same street.
    const points = [
      { lat: 51.1, lon: 17.0 },
      { lat: 51.1, lon: 17.01 },
      { lat: 51.1, lon: 17.0 },
    ];
    const stops = stopsAlong(points, [
      { name: 'start', lat: 51.1, lon: 17.0 },
      { name: 'east', lat: 51.1, lon: 17.01 },
      { name: 'middle-back', lat: 51.1, lon: 17.005 },
    ]);
    expect(stops.map((stop) => Math.round(stop.along))).toEqual([0, 698, 1047]);
    expect(nextStop(stops, 300)?.name).toBe('east');
    expect(nextStop(stops, 690)?.name).toBe('middle-back');
    expect(nextStop(stops, 2000)).toBeNull();
  });
});

describe('Open Data diagnostics and clock', () => {
  const rowAt = (time: unknown, overrides: Record<string, unknown> = {}) => ({
    Nazwa_Linii: '4',
    Nr_Boczny: 3012,
    Brygada: '00407',
    Ostatnia_Pozycja_Szerokosc: 51.1101,
    Ostatnia_Pozycja_Dlugosc: 17.0301,
    Data_Aktualizacji: time,
    ...overrides,
  });

  test('timestamps written in UTC are recognised instead of aging every row out', () => {
    // 07:59:40 Wrocław = 05:59:40 UTC, written without a zone.
    const rows = [rowAt('2026-06-15 05:59:40'), rowAt('2026-06-15 05:59:50', { Nr_Boczny: 3013 })];
    const result = parseOpenDataRows(rows, { now: NOW, isTram });
    expect(result.clock).toBe('utc');
    expect(result.vehicles).toHaveLength(2);
    expect(result.vehicles[0].positionAt).toBe(Date.parse('2026-06-15T05:59:40Z'));
    expect(result.medianAgeSeconds).toBe(20);
  });

  test('Wrocław time stays the default; every dropped row is counted by reason', () => {
    const rows = [
      rowAt('2026-06-15 07:59:40'),
      rowAt('15.06.2026 07:59:30', { Nr_Boczny: 3013 }),
      rowAt('2026-06-15 07:50:00', { Nr_Boczny: 3014 }),
      rowAt('soon', { Nr_Boczny: 3015 }),
      rowAt('2026-06-15 07:59:40', { Nr_Boczny: 0 }),
      rowAt('2026-06-15 07:59:40', { Nazwa_Linii: '' }),
      rowAt('2026-06-15 07:59:40', { Ostatnia_Pozycja_Szerokosc: '51,1101', Nr_Boczny: 3016 }),
      rowAt(1_781_503_190, { Nr_Boczny: 3017 }),
    ];
    const result = parseOpenDataRows(rows, { now: NOW, isTram });
    expect(result.clock).toBe('warsaw');
    expect(result.total).toBe(8);
    expect(result.vehicles.map((v) => v.vehicleNumber)).toEqual(['3012', '3013', '3016', '3017']);
    expect(result.rejected).toEqual({ time: 1, number: 1, line: 1, stale: 1 });
  });
});
