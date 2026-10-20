import { strToU8, zipSync } from 'fflate';
import { importGtfs } from '../src/core/gtfs/importer';
import { getDepartures, searchStops } from '../src/core/gtfs/queries';
import { fixtureTables } from './fixtures/gtfs';
import { openTestDb } from './sqljs-db';

test('import ~1.1M stop_times', async () => {
  const tables = fixtureTables();
  const stops = ['stop_id,stop_code,stop_name,stop_lat,stop_lon'];
  for (let i = 0; i < 2500; i += 1) stops.push(`${i},${i},Stop ${Math.floor(i / 3)},51.1,17.0`);
  const trips = ['route_id,service_id,trip_id,trip_headsign,direction_id,shape_id'];
  const times = ['trip_id,arrival_time,departure_time,stop_id,stop_sequence'];
  for (let t = 0; t < 40000; t += 1) {
    trips.push(`4,WEEKDAY,T${t},Somewhere,0,s4a`);
    const start = 5 * 3600 + (t % 1000) * 60;
    for (let s = 0; s < 28; s += 1) {
      const sec = start + s * 90;
      const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
      const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
      times.push(`T${t},${hh}:${mm}:00,${hh}:${mm}:00,${(t * 7 + s) % 2500},${s + 1}`);
    }
  }
  tables['stops.txt'] = stops.join('\n');
  tables['trips.txt'] = trips.join('\n');
  tables['stop_times.txt'] = times.join('\n');
  const zip = zipSync(Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, strToU8(v)])));
  console.log('zip MB', (zip.length / 1e6).toFixed(1), 'rows', times.length - 1);
  const db = await openTestDb();
  let t0 = Date.now();
  const summary = await importGtfs(zip, db, { source: { url: 'x', name: null } });
  console.log('import s', (Date.now() - t0) / 1000, summary.counts);
  t0 = Date.now();
  await searchStops(db, 'stop 12');
  const posts = [10, 11, 12];
  const deps = await getDepartures(db, posts, { now: Date.parse('2026-06-15T09:00:00+02:00') });
  console.log('queries ms', Date.now() - t0, 'departures', deps.length, 'db MB', (db.raw.export().length / 1e6).toFixed(1));
}, 600000);
