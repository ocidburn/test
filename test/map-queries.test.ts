import { importGtfs } from '../src/core/gtfs/importer';
import { getLines, getStopsInBBox, getVariants, getVariantStops, lineSets, timetableResolver } from '../src/core/gtfs/map-queries';
import { markerKind } from '../src/core/lines';
import { matchVariant } from '../src/core/realtime/route-match';
import { buildFixtureZip } from './fixtures/gtfs';
import { openTestDb } from './sqljs-db';

const setup = async () => {
  const db = await openTestDb();
  await importGtfs(buildFixtureZip(), db, { source: { url: 'x', name: null } });
  return db;
};

test('lines split into trams and buses for the MPK request', async () => {
  const db = await setup();
  const lines = await getLines(db);
  expect(lines.map((line) => [line.name, line.tram])).toEqual([
    ['4', true],
    ['128', false],
    ['240', false],
    ['A', false],
  ]);
  expect(lineSets(lines)).toEqual({ trams: ['4'], buses: ['128', '240', 'A'] });
});

test('variants of a line carry their headsign and geometry, and match a vehicle', async () => {
  const db = await setup();
  const variants = await getVariants(db, '4');
  expect(variants.map((variant) => [variant.headsign, variant.trips, variant.points.length]).sort()).toEqual([
    ['Biskupin', 1, 2],
    ['Oporów', 2, 3],
  ]);
  // On s4a between Rynek and Świdnicka, heading south.
  const match = matchVariant(variants, { lat: 51.108, lon: 17.0325, heading: 175 });
  expect(match?.variant.headsign).toBe('Oporów');
  const stops = await getVariantStops(db, match!.variant.shapeIdx);
  expect(stops.map((stop) => stop.name)).toEqual(['Rynek', 'Świdnicka', 'Oporów']);
});

test('stops in view are only those a line serves', async () => {
  const db = await setup();
  const stops = await getStopsInBBox(db, { minLat: 51.1, maxLat: 51.12, minLon: 17.0, maxLon: 17.05 });
  // Świdnicka's second post (stop 7) has no trips.
  expect(stops.map((stop) => stop.code).sort()).toEqual(['10101', '10102', '20201']);
});

test('the resolver reads trip and route ids from the timetable', async () => {
  const db = await setup();
  const resolver = timetableResolver(db);
  await expect(resolver.byTripId('t4b')).resolves.toEqual({ line: '4', tram: true, headsign: 'Biskupin' });
  await expect(resolver.byRouteId('128')).resolves.toEqual({ line: '128', tram: false });
  await expect(resolver.byTripId('nope')).resolves.toBeNull();
  await expect(resolver.hasLine('240')).resolves.toBe(true);
  await expect(resolver.hasLine('999')).resolves.toBe(false);
});

test('marker body by kind of line', () => {
  expect([markerKind('8', true), markerKind('146', false), markerKind('K', false), markerKind('242', false), markerKind('911', false)]).toEqual([
    'tram',
    'bus',
    'express',
    'night',
    'suburban',
  ]);
});
