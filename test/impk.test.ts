import { parseImpkPositions, parseImpkPostInfo } from '../src/core/realtime/impk';
import type { TripResolver } from '../src/core/realtime/klosok';
import { LiveTracker } from '../src/core/realtime/tracker';

// The start of a real getPositions answer (2026-10-21, 13:40:50 Wrocław = 11:40:50 UTC).
const SAMPLE = JSON.stringify([
  '2026-10-21 13:40:50',
  { v: 4102, c: 29086669, x: 17.091331, y: 51.11346, l: '715', t: 'b', s: '24313', d: '24708', e: 0 },
  { v: 4105, c: 29086630, x: 17.117128, y: 51.11088, l: '715', t: 'b', s: '44704', d: '24317', e: 289000 },
  { v: 3102, c: 29256014, x: 16.993567, y: 51.121353, l: '3', t: 't', s: '12202', d: '25013', e: -31000 },
  { v: 3112, c: 29254770, x: 17.039173, y: 51.077286, l: '18', t: 't', s: '21030', d: '18401', e: -1153000 },
]);
const SERVER_AT = Date.parse('2026-10-21T11:40:50Z');
const isTram = (line: string, hint?: string | null) => hint === 'tram' || Number(line) < 40;

describe('iMPK getPositions', () => {
  test('reads a real answer', () => {
    const { vehicles, destinations, detail } = parseImpkPositions(SAMPLE, { now: SERVER_AT + 4_000, isTram });
    expect(vehicles.map((v) => [v.id, v.line, v.tram, v.vehicleNumber, v.delaySeconds])).toEqual([
      ['impk:4102', '715', false, '4102', 0],
      ['impk:4105', '715', false, '4105', 289],
      ['impk:3102', '3', true, '3102', -31],
      ['impk:3112', '18', true, '3112', -1153],
    ]);
    expect(vehicles[0]).toMatchObject({ lat: 51.11346, lon: 17.091331, source: 'impk', heading: null, positionAt: SERVER_AT });
    expect(destinations.get('impk:3112')).toBe('18401');
    expect(vehicles[3].course).toBe('29254770');
    expect(detail).toEqual({ total: 4, rejected: {}, medianAgeSeconds: 4 });
  });

  test('reads the spelled-out keys too (no shortcut=true)', () => {
    const body = JSON.stringify([
      '2026-10-21 14:28:20',
      { code: 4105, course: 29086632, x: 17.118454, y: 51.109913, line: '715', type: 'BUS', symbol: '44704', direction: '24317', delay: 34000 },
      { code: 3101, course: 29254933, x: 17.048319, y: 51.085026, line: '18', type: 'TRAM', symbol: '21011', direction: '21037', delay: -60000 },
    ]);
    const { vehicles, destinations } = parseImpkPositions(body, { now: SERVER_AT + 3_600_000, isTram: (line, hint) => hint === 'tram' });
    expect(vehicles.map((v) => [v.id, v.line, v.tram, v.delaySeconds])).toEqual([
      ['impk:4105', '715', false, 34],
      ['impk:3101', '18', true, -60],
    ]);
    expect(destinations.get('impk:3101')).toBe('21037');
  });

  test('a server clock ahead of the phone does not date fixes in the future', () => {
    const { vehicles } = parseImpkPositions(SAMPLE, { now: SERVER_AT - 60_000, isTram });
    expect(vehicles[0].positionAt).toBe(SERVER_AT - 60_000);
  });

  test('drops unusable rows and says why', () => {
    const body = JSON.stringify([
      '2026-10-21 13:40:50',
      { v: 1, x: 17.0, y: 51.1, l: '', t: 'b' },
      { x: 17.0, y: 51.1, l: '4', t: 't' },
      { v: 2, x: 0, y: 0, l: '4', t: 't' },
      'junk',
      { v: 3, x: 17.0, y: 51.1, l: 'a', t: 'b', e: 'late' },
    ]);
    const { vehicles, detail } = parseImpkPositions(body, { now: SERVER_AT, isTram });
    expect(vehicles.map((v) => [v.id, v.line, v.delaySeconds])).toEqual([['impk:3', 'A', null]]);
    expect(detail.rejected).toEqual({ line: 1, number: 1, position: 1, shape: 1 });
  });

  test('an answer it cannot read is an error, not an empty map', () => {
    const now = SERVER_AT;
    expect(() => parseImpkPositions('', { now, isTram })).toThrow('empty body');
    expect(() => parseImpkPositions('<html>', { now, isTram })).toThrow('not JSON');
    expect(() => parseImpkPositions('{"error":1}', { now, isTram })).toThrow('not a list');
    expect(() => parseImpkPositions('[]', { now, isTram })).toThrow('empty list');
  });
});

describe('iMPK getPostInfo', () => {
  test('reads a real answer, soonest first', () => {
    // The start of a real answer for post 21011 (2026-10-21, 14:48 Wrocław).
    const body = JSON.stringify([
      { l: '21', d: '21037', t: '2026-10-21 14:51:00', c: 29254717 },
      { l: '8', d: '21021', t: '2026-10-21 14:50:00', c: 29256948 },
      { l: '16', d: '21021', t: '2026-10-21 14:55:00', c: 29254514 },
      { l: '18', d: '21037', t: '2026-10-21 14:58:00', c: 29254648 },
    ]);
    expect(parseImpkPostInfo(body)).toEqual([
      { line: '8', destination: '21021', scheduledAt: Date.parse('2026-10-21T12:50:00Z'), course: '29256948' },
      { line: '21', destination: '21037', scheduledAt: Date.parse('2026-10-21T12:51:00Z'), course: '29254717' },
      { line: '16', destination: '21021', scheduledAt: Date.parse('2026-10-21T12:55:00Z'), course: '29254514' },
      { line: '18', destination: '21037', scheduledAt: Date.parse('2026-10-21T12:58:00Z'), course: '29254648' },
    ]);
  });

  test('an empty board is empty; an unreadable one is an error', () => {
    expect(parseImpkPostInfo('[]')).toEqual([]);
    expect(parseImpkPostInfo(JSON.stringify([{ l: '8' }, 'x', { l: '9', t: '2026-10-21 15:00:00' }]))).toHaveLength(1);
    expect(() => parseImpkPostInfo('<html>')).toThrow('not JSON');
    expect(() => parseImpkPostInfo('{}')).toThrow('not a list');
  });
});

describe('tracker with iMPK', () => {
  test('a vehicle that has not moved points along its route, then follows its movement', async () => {
    let now = SERVER_AT + 1_000;
    let body = JSON.stringify(['2026-10-21 13:40:50', { v: 1, x: 17.03, y: 51.1, l: '4', t: 't', d: '30301', e: 0 }]);
    const asked: string[] = [];
    const tracker = new LiveTracker({
      lines: async () => ({ trams: ['4'], buses: [] }),
      isTram,
      resolver: { byTripId: async () => null, byRouteId: async () => null, hasLine: async () => true },
      fetchImpl: jest.fn(async () => {
        throw new Error('offline');
      }),
      now: () => now,
      impk: async () => ({ url: 'https://impk.example/', session: { fetchText: async () => body } }),
      routeHeading: async (line, destination) => {
        asked.push(`${line}->${destination}`);
        return 180;
      },
    });
    let snapshot = await tracker.poll();
    expect(snapshot.vehicles[0].heading).toBe(180);
    // Standing still: the route heading stays, and is not looked up again.
    now += 10_000;
    snapshot = await tracker.poll();
    expect(snapshot.vehicles[0].heading).toBe(180);
    expect(asked).toEqual(['4->30301']);
    // Moving east: its own movement wins.
    now += 10_000;
    body = JSON.stringify(['2026-10-21 13:41:10', { v: 1, x: 17.032, y: 51.1, l: '4', t: 't', d: '30301', e: 0 }]);
    snapshot = await tracker.poll();
    expect(snapshot.vehicles[0].heading).toBeGreaterThan(80);
    expect(snapshot.vehicles[0].heading).toBeLessThan(100);
  });

  const resolver: TripResolver = { byTripId: async () => null, byRouteId: async () => null, hasLine: async () => true };
  const lines = async () => ({ trams: ['3', '18'], buses: ['715'] });

  test('iMPK stands in for MPK and Open Data on the map, which are still read and compared', async () => {
    let now = SERVER_AT + 2_000;
    const calls: string[] = [];
    let impkBody: string | Error = SAMPLE;
    const fetchImpl = jest.fn(async (url: string) => {
      calls.push(url.includes('bus_position') ? 'mpk' : url.includes('hdb') ? 'od' : 'klosok');
      if (url.includes('bus_position')) return new Response(JSON.stringify([{ x: 51.1, y: 17.03, name: '4', k: 9 }]));
      if (url.includes('hdb')) return new Response(JSON.stringify({ dane: [] }));
      throw new Error('offline');
    });
    const impkUrls: string[] = [];
    let enabled = true;
    const tracker = new LiveTracker({
      lines,
      isTram,
      resolver,
      fetchImpl,
      now: () => now,
      impk: async () =>
        enabled
          ? {
              url: 'https://impk.example:8088/',
              session: {
                fetchText: async (url: string) => {
                  impkUrls.push(url);
                  if (impkBody instanceof Error) throw impkBody;
                  return impkBody;
                },
              },
            }
          : null,
      stopNames: async () => new Map([['18401', 'Oporów']]),
    });

    // First round: iMPK has not answered yet, so everything is asked.
    let snapshot = await tracker.poll();
    expect(impkUrls[0]).toBe('https://impk.example:8088/mobile?function=getPositions&shortcut=true');
    expect(calls.sort()).toEqual(['klosok', 'mpk', 'od']);
    // iMPK's answer is used on its own, not merged with MPK's.
    expect(snapshot.vehicles.map((v) => v.id)).toEqual(['impk:4102', 'impk:4105', 'impk:3102', 'impk:3112']);
    expect(snapshot.vehicles.find((v) => v.id === 'impk:3112')?.headsign).toBe('Oporów');

    // MPK and Open Data are still asked while iMPK answers, and compared with it.
    expect(snapshot.comparisons).toHaveLength(1);
    expect(snapshot.comparisons[0]).toMatchObject({ at: SERVER_AT + 2_000, counts: { impk: 4, mpk: 1, openData: 0 } });
    expect(snapshot.comparisons[0].mpk).toMatchObject({ matched: 0, onlyImpk: 4, onlyOther: 1 });
    calls.length = 0;
    now += 10_000;
    snapshot = await tracker.poll();
    // (Kłosok, failing here, is in its own pause; Open Data keeps its once-a-minute pace.)
    expect(calls).toEqual(['mpk']);
    expect(snapshot.status.impk).toMatchObject({ ok: true, count: 4, idle: null });
    // The map still shows iMPK alone.
    expect(snapshot.vehicles.map((v) => v.source)).toEqual(['impk', 'impk', 'impk', 'impk']);
    expect(snapshot.comparisons).toHaveLength(2);

    // iMPK failing: its last answer stays on the map, and nothing new is logged.
    impkBody = new Error('timeout');
    now += 10_000;
    snapshot = await tracker.poll();
    expect(snapshot.vehicles).toHaveLength(4);
    expect(snapshot.comparisons).toHaveLength(2);

    // Switched off: iMPK's vehicles leave the map at once.
    enabled = false;
    now += 1_000;
    snapshot = await tracker.poll();
    expect(snapshot.status.impk.idle).toBe('off');
    expect(snapshot.vehicles.map((v) => v.source)).toEqual(['mpk']);
    expect(snapshot.comparisons).toEqual([]);
  });
});
