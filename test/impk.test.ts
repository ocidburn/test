import { parseImpkPositions } from '../src/core/realtime/impk';
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
    expect(detail).toEqual({ total: 4, rejected: {}, medianAgeSeconds: 4 });
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

describe('tracker with iMPK', () => {
  const resolver: TripResolver = { byTripId: async () => null, byRouteId: async () => null, hasLine: async () => true };
  const lines = async () => ({ trams: ['3', '18'], buses: ['715'] });

  test('iMPK stands in for MPK and Open Data, with headsigns from post symbols', async () => {
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

    // While iMPK answers, MPK and Open Data are not asked.
    calls.length = 0;
    now += 10_000;
    snapshot = await tracker.poll();
    // (Kłosok, failing here, is in its own pause.)
    expect(calls).toEqual([]);
    expect(snapshot.status.mpk.idle).toBe('covered');
    expect(snapshot.status.impk).toMatchObject({ ok: true, count: 4, idle: null });

    // iMPK failing: its last answer stays on the map, and after 30 s the others are back.
    impkBody = new Error('timeout');
    now += 10_000;
    snapshot = await tracker.poll();
    expect(snapshot.vehicles).toHaveLength(4);
    now += 25_000;
    calls.length = 0;
    snapshot = await tracker.poll();
    // MPK at once; Open Data keeps its once-a-minute pace.
    expect(calls.filter((c) => c !== 'klosok')).toEqual(['mpk']);
    expect(snapshot.status.openData.idle).toBeNull();

    // Switched off: iMPK's vehicles leave the map at once.
    enabled = false;
    now += 1_000;
    snapshot = await tracker.poll();
    expect(snapshot.status.impk.idle).toBe('off');
    expect(snapshot.vehicles.map((v) => v.source)).toEqual(['mpk']);
  });
});
