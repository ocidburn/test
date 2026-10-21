import { importGtfs } from '../src/core/gtfs/importer';
import { getDepartures, getStopPosts, nearbyStops, readMeta, searchStops, stopsByNames } from '../src/core/gtfs/queries';
import { buildFixtureZip, warsaw } from './fixtures/gtfs';
import { openTestDb } from './sqljs-db';

const importFixture = async (options?: Parameters<typeof buildFixtureZip>[0]) => {
  const db = await openTestDb();
  const progress: number[] = [];
  const summary = await importGtfs(buildFixtureZip(options), db, {
    source: { url: 'https://example/119/', name: 'GTFS_25072026' },
    now: 1_780_000_000_000,
    onProgress: ({ fraction }) => progress.push(fraction),
  });
  return { db, summary, progress };
};

const rynekIdxs = async (db: Awaited<ReturnType<typeof openTestDb>>) =>
  (await getStopPosts(db, 'Rynek')).map((post) => post.stopIdx);

describe('import', () => {
  test('counts, meta and monotonic progress', async () => {
    const { db, summary, progress } = await importFixture();
    expect(summary.counts).toEqual({ routes: 4, stops: 7, trips: 6, stopTimes: 15, shapes: 3 });
    const meta = await readMeta(db);
    expect(meta).toMatchObject({ schemaVersion: 1, sourceName: 'GTFS_25072026', feedStart: 20260601, feedEnd: 20261231 });
    expect(progress[progress.length - 1]).toBe(1);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  test('letter lines are upper-cased to match the live feed', async () => {
    const { db } = await importFixture();
    const lines = await db.all<{ short_name: string }>('SELECT short_name FROM routes ORDER BY route_idx');
    expect(lines.map((row) => row.short_name)).toEqual(['4', '128', '240', 'A']);
  });

  test('shape points are stored in sequence order', async () => {
    const { db } = await importFixture();
    const row = await db.first<{ points: Uint8Array }>("SELECT points FROM shapes WHERE shape_id = 's4a'");
    const floats = new Float32Array(new Uint8Array(row!.points).buffer);
    expect(Array.from(floats).map((value) => Number(value.toFixed(3)))).toEqual([51.11, 17.032, 51.105, 17.033, 51.08, 16.98]);
  });

  test('works with tables nested in a folder and stored uncompressed', async () => {
    const { summary } = await importFixture({ prefix: 'GTFS/', stored: true });
    expect(summary.counts.stopTimes).toBe(15);
  });

  test('refuses an incomplete snapshot before touching the database', async () => {
    await expect(importFixture({ omit: ['shapes.txt'] })).rejects.toThrow(/missing shapes\.txt/);
  });
});

describe('stop search', () => {
  test('diacritic-insensitive, grouped by name, with sorted lines', async () => {
    const { db } = await importFixture();
    const results = await searchStops(db, 'swid');
    expect(results).toEqual([
      { name: 'Świdnicka', posts: 2, lines: [{ name: '4', tram: true, color: null }] },
    ]);
    const rynek = await searchStops(db, 'RYN');
    expect(rynek[0]).toMatchObject({ name: 'Rynek', posts: 2 });
    expect(rynek[0].lines.map((line) => line.name)).toEqual(['4', '128', '240', 'A']);
  });

  test('word prefixes rank before infix matches', async () => {
    const { db } = await importFixture();
    expect((await searchStops(db, 'petla')).map((row) => row.name)).toEqual(['Krzyki, pętla']);
    expect(await searchStops(db, '  ')).toEqual([]);
  });
});

describe('departures', () => {
  test('soonest first, across posts, without arrivals at the terminus', async () => {
    const { db } = await importFixture();
    // Monday 2026-06-15, 07:58.
    const now = warsaw('2026-06-15T07:58:00');
    const departures = await getDepartures(db, await rynekIdxs(db), { now, windowMinutes: 300 });
    expect(departures.map((d) => [d.line, d.headsign, d.stopCode, new Date(d.at).toISOString()])).toEqual([
      ['4', 'Oporów', '10101', '2026-06-15T06:00:00.000Z'],
      ['4', 'Oporów', '10101', '2026-06-15T07:00:00.000Z'],
      ['4', 'Biskupin', '10102', '2026-06-15T08:10:00.000Z'],
      ['128', 'Krzyki', '10102', '2026-06-15T10:00:00.000Z'],
    ]);
    // Express A only arrives at Rynek, its last stop (13:20), so it is not a departure.
    expect(departures.some((d) => d.line === 'A')).toBe(false);
    // The default two-hour window stops before 10:00.
    expect((await getDepartures(db, await rynekIdxs(db), { now })).map((d) => d.line)).toEqual(['4', '4']);
  });

  test('a calendar_dates removal cancels the day', async () => {
    const { db } = await importFixture();
    const departures = await getDepartures(db, await rynekIdxs(db), { now: warsaw('2026-06-17T07:58:00') });
    expect(departures).toEqual([]);
  });

  test("a 25:30 trip from Saturday's timetable departs early Sunday", async () => {
    const { db } = await importFixture();
    const departures = await getDepartures(db, await rynekIdxs(db), { now: warsaw('2026-06-21T01:00:00') });
    expect(departures).toHaveLength(1);
    expect(departures[0]).toMatchObject({ line: '240', serviceDay: 20260620, tram: false });
    expect(new Date(departures[0].at).toISOString()).toBe('2026-06-20T23:30:00.000Z');
  });

  test('a departure that just left stays visible for a minute', async () => {
    const { db } = await importFixture();
    const departures = await getDepartures(db, await rynekIdxs(db), { now: warsaw('2026-06-15T08:00:40') });
    expect(departures[0].line).toBe('4');
    const later = await getDepartures(db, await rynekIdxs(db), { now: warsaw('2026-06-15T08:01:30') });
    expect(new Date(later[0].at).toISOString()).toBe('2026-06-15T07:00:00.000Z');
  });
});

describe('favourites and nearby stops', () => {
  test('stops by name keep the order asked and drop unknown names', async () => {
    const { db } = await importFixture();
    const stops = await stopsByNames(db, ['Świdnicka', 'Nie ma', 'Rynek']);
    expect(stops.map((stop) => [stop.name, stop.posts, stop.lines.map((line) => line.name)])).toEqual([
      ['Świdnicka', 2, ['4']],
      ['Rynek', 2, ['4', '128', '240', 'A']],
    ]);
  });

  test('nearby stops, nearest first, within the radius', async () => {
    const { db } = await importFixture();
    // Standing 100 m south of Rynek; Świdnicka is ~550 m further.
    const stops = await nearbyStops(db, 51.1091, 17.032, { radiusMeters: 800 });
    expect(stops.map((stop) => stop.name)).toEqual(['Rynek', 'Świdnicka']);
    expect(stops[0].distanceMeters).toBeLessThan(stops[1].distanceMeters);
    expect(await nearbyStops(db, 51.1091, 17.032, { radiusMeters: 150 })).toHaveLength(1);
  });
});
