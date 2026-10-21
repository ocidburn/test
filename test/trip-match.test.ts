import { getVariantProfile, buildActiveOn } from '../src/core/gtfs/trip-queries';
import { importGtfs } from '../src/core/gtfs/importer';
import { getVariants } from '../src/core/gtfs/map-queries';
import { delayMinutesLabel, delayStatus, describeRun, matchTrip, MAX_DELAY_SECONDS, offsetAt, type VariantProfile } from '../src/core/realtime/trip-match';
import { buildFixtureZip, warsaw } from './fixtures/gtfs';
import { openTestDb } from './sqljs-db';

const setup = async () => {
  const db = await openTestDb();
  await importGtfs(buildFixtureZip(), db, { source: { url: 'x', name: null } });
  return db;
};

/** The s4a variant of line 4 (Rynek → Świdnicka → Oporów), with its two weekday runs. */
const oporowProfile = async (db: Awaited<ReturnType<typeof openTestDb>>) => {
  const variants = await getVariants(db, '4');
  const oporow = variants.find((v) => v.headsign === 'Oporów')!;
  return (await getVariantProfile(db, oporow.shapeIdx, '4', oporow.headsign))!;
};

describe('trip profile', () => {
  test('stops carry along-distance and offsets from the run start', async () => {
    const db = await setup();
    const profile = await oporowProfile(db);
    expect(profile.stops.map((s) => [s.name, s.arrivalOffset])).toEqual([
      ['Rynek', 0],
      ['Świdnicka', 300],
      ['Oporów', 900],
    ]);
    expect(profile.stops[0].alongMeters).toBeLessThan(1);
    expect(profile.stops[2].alongMeters).toBeCloseTo(profile.lengthMeters, 5);
    expect(profile.trips.map((t) => t.startSeconds)).toEqual([28800, 32400]); // 08:00, 09:00
  });
});

describe('offsetAt', () => {
  const stops = [
    { alongMeters: 0, arrivalOffset: 0, departureOffset: 0 },
    { alongMeters: 1000, arrivalOffset: 300, departureOffset: 330 },
    { alongMeters: 3000, arrivalOffset: 900, departureOffset: 900 },
  ] as VariantProfile['stops'];

  test('interpolates from the previous departure to the next arrival', () => {
    expect(offsetAt(stops, 0).offset).toBe(0);
    expect(offsetAt(stops, 1000).offset).toBe(300);
    // Halfway from stop 1 (dep 330, 1000 m) to stop 2 (arr 900, 3000 m) = 2000 m.
    expect(offsetAt(stops, 2000).offset).toBe(330 + 0.5 * (900 - 330));
    expect(offsetAt(stops, 5000).offset).toBe(900);
  });
});

describe('matchTrip', () => {
  test('picks the run that would be here now; the gap is the delay', async () => {
    const db = await setup();
    const profile = await oporowProfile(db);
    const activeOn = await buildActiveOn(db, warsaw('2026-06-15T08:07:00'));
    // At Świdnicka (progressOffset 300 s) at 08:07 → run that started 08:00, 2 min late.
    const run = matchTrip(profile, 300, warsaw('2026-06-15T08:07:00'), activeOn);
    expect(run).toMatchObject({ startSeconds: 28800, delaySeconds: 120, dateKey: 20260615 });
  });

  test('a run running early is negative; the nearer departure wins', async () => {
    const db = await setup();
    const profile = await oporowProfile(db);
    const activeOn = await buildActiveOn(db, warsaw('2026-06-15T09:03:00'));
    // 09:03 at Świdnicka → the 09:00 run, 2 min early (the 08:00 run is past the window).
    const run = matchTrip(profile, 300, warsaw('2026-06-15T09:03:00'), activeOn);
    expect(run).toMatchObject({ startSeconds: 32400, delaySeconds: -120 });
  });

  test('no run beyond the delay window', () => {
    const profile: VariantProfile = {
      shapeIdx: 1,
      line: '4',
      headsign: 'X',
      lengthMeters: 1000,
      stops: [
        { stopIdx: 0, name: 'A', code: null, lat: 0, lon: 0, seq: 1, alongMeters: 0, arrivalOffset: 0, departureOffset: 0 },
        { stopIdx: 1, name: 'B', code: null, lat: 0, lon: 0, seq: 2, alongMeters: 1000, arrivalOffset: 600, departureOffset: 600 },
      ],
      // One run at 08:00; nothing else all morning.
      trips: [{ tripIdx: 0, serviceIdx: 0, startSeconds: 28800 }],
    };
    const activeOn = () => true;
    // 10:00, progressOffset 0 → 2 h from the only run, well past 45 min.
    expect(matchTrip(profile, 0, warsaw('2026-06-15T10:00:00'), activeOn)).toBeNull();
    // At its own start minus a few minutes, it matches.
    expect(matchTrip(profile, 0, warsaw('2026-06-15T08:10:00'), activeOn)?.delaySeconds).toBe(600);
    expect(MAX_DELAY_SECONDS).toBe(2700);
  });

  test('only a service running that day matches', async () => {
    const db = await setup();
    const profile = await oporowProfile(db);
    // 2026-06-17 is removed for WEEKDAY by calendar_dates in the fixture.
    const activeOn = await buildActiveOn(db, warsaw('2026-06-17T08:07:00'));
    expect(matchTrip(profile, 300, warsaw('2026-06-17T08:07:00'), activeOn)).toBeNull();
  });
});

describe('describeRun', () => {
  test('delay, next stop and live ETA from the real position', async () => {
    const db = await setup();
    const profile = await oporowProfile(db);
    const now = warsaw('2026-06-15T08:07:00');
    const activeOn = await buildActiveOn(db, now);
    // Vehicle sitting at Świdnicka (along = its distance).
    const along = profile.stops[1].alongMeters;
    const run = describeRun(profile, along, now, activeOn)!;
    expect(run.delaySeconds).toBe(120);
    expect(run.headsign).toBe('Oporów');
    expect(run.nextStop?.name).toBe('Oporów');
    // Oporów arr offset 900, progress 300 → 600 s of scheduled running left.
    expect(run.nextStop?.etaSeconds).toBe(600);
    expect(new Date(run.nextStop!.scheduledAt!).toISOString()).toBe('2026-06-15T06:15:00.000Z'); // 08:15 local
    expect(run.stopsAhead).toBe(1);
  });

  test('a lagging position is matched at its own time, not now', async () => {
    const db = await setup();
    const profile = await oporowProfile(db);
    // The same fix as above (2 min late at 08:07), delivered 5 minutes later.
    const positionAt = warsaw('2026-06-15T08:07:00');
    const now = positionAt + 5 * 60_000;
    const activeOn = await buildActiveOn(db, now);
    const along = profile.stops[1].alongMeters;
    const run = describeRun(profile, along, now, activeOn, { positionAt })!;
    // The feed's lag is not delay.
    expect(run.delaySeconds).toBe(120);
    // 600 s left at the fix, 300 s of which have gone by.
    expect(run.nextStop?.etaSeconds).toBe(300);
  });

  test('null when the variant has no usable times', () => {
    const profile: VariantProfile = {
      shapeIdx: 1,
      line: '4',
      headsign: 'X',
      lengthMeters: 1000,
      stops: [{ stopIdx: 0, name: 'A', code: null, lat: 0, lon: 0, seq: 1, alongMeters: 0, arrivalOffset: 0, departureOffset: 0 }],
      trips: [],
    };
    expect(describeRun(profile, 0, Date.now(), () => true)).toBeNull();
  });
});

describe('delayStatus', () => {
  test('buckets for the delay badges; a minute early is its own class', () => {
    expect([null, -90, -60, -59, 0, 119, 120, 300, 301].map(delayStatus)).toEqual([
      'none', 'early', 'early', 'ok', 'ok', 'ok', 'mid', 'mid', 'late',
    ]);
  });

  test('minutes as the badges show them, with a real minus sign', () => {
    expect([250, 540, -130, 20, -20].map(delayMinutesLabel)).toEqual(['+4', '+9', '−2', '0', '0']);
  });
});
