import { BatchInserter, type Db } from '../db';
import { normalizeSearch } from '../text';
import { assertComplete, readEffectiveWindow, type FeedWindow } from './archive';
import { columnIndex, CsvStream, parseTable, timeToSeconds } from './csv';
import { CREATE_INDEXES, CREATE_TABLES, SCHEMA_VERSION } from './schema';
import { findEntry, looksLikeZip, readEntryText, readZipDirectory, streamEntryText, type ZipEntry } from './zip';

export type ImportProgress = { phase: string; fraction: number };

export type ImportSource = { url: string; name: string | null };

export type ImportSummary = {
  window: FeedWindow | null;
  counts: { routes: number; stops: number; trips: number; stopTimes: number; shapes: number };
};

/** Validate an archive without importing it: is it a complete GTFS feed, and when is it valid? */
export const inspectArchive = (bytes: Uint8Array): { entries: ZipEntry[]; window: FeedWindow | null } => {
  if (!looksLikeZip(bytes)) throw new Error(`not a zip archive (${bytes.length} bytes)`);
  const entries = readZipDirectory(bytes);
  assertComplete(entries);
  return { entries, window: readEffectiveWindow(bytes, entries) };
};

/** Stream a table row by row, awaiting the handler so database writes apply backpressure. */
const streamTable = async (
  bytes: Uint8Array,
  entry: ZipEntry,
  onRow: (fields: string[], col: (name: string) => number) => Promise<void> | void,
  onProgress?: (fraction: number) => void,
) => {
  const csv = new CsvStream();
  let col: ((name: string) => number) | null = null;
  const handle = async (rows: string[][]) => {
    for (const fields of rows) {
      if (!col) {
        col = columnIndex(fields);
        continue;
      }
      await onRow(fields, col);
    }
  };
  await streamEntryText(bytes, entry, (text) => handle(csv.push(text)), { onProgress });
  await handle(csv.end());
};

const intOrNull = (value: string | undefined) => {
  if (value === undefined || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const floatOrNull = (value: string | undefined) => {
  if (value === undefined || value === '') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Dense integer ids for upstream string ids. */
class IdMap {
  private readonly map = new Map<string, number>();
  get size() {
    return this.map.size;
  }
  get(id: string) {
    return this.map.get(id);
  }
  entries() {
    return this.map.entries();
  }
  /** Returns [index, isNew]. */
  intern(id: string): [number, boolean] {
    const existing = this.map.get(id);
    if (existing !== undefined) return [existing, false];
    const index = this.map.size;
    this.map.set(id, index);
    return [index, true];
  }
}

const WEEKDAY_COLUMNS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const encodeShape = (points: { seq: number; lat: number; lon: number }[]) => {
  points.sort((a, b) => a.seq - b.seq);
  const floats = new Float32Array(points.length * 2);
  points.forEach((point, index) => {
    floats[index * 2] = point.lat;
    floats[index * 2 + 1] = point.lon;
  });
  return new Uint8Array(floats.buffer);
};

/**
 * Import a GTFS archive into an empty database.
 *
 * The caller owns the database file: it imports into a fresh one and swaps
 * it in only when this resolves, so a failed or interrupted import never
 * replaces a working timetable.
 */
export const importGtfs = async (
  bytes: Uint8Array,
  db: Db,
  {
    source,
    now = Date.now(),
    onProgress = () => {},
  }: { source: ImportSource; now?: number; onProgress?: (progress: ImportProgress) => void },
): Promise<ImportSummary> => {
  const { entries, window } = inspectArchive(bytes);
  const table = (name: string) => findEntry(entries, `${name}.txt`);
  const report = (phase: string, fraction: number) => onProgress({ phase, fraction });

  // A fresh file nobody else reads: durability during the load buys nothing.
  await db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA temp_store = MEMORY;');
  await db.exec(CREATE_TABLES);

  const routes = new IdMap();
  const stops = new IdMap();
  const services = new IdMap();
  const shapes = new IdMap();
  const trips = new IdMap();
  let stopTimeCount = 0;

  await db.transaction(async () => {
    report('routes', 0.01);
    const routeInserter = new BatchInserter(db, 'routes', ['route_idx', 'route_id', 'short_name', 'long_name', 'route_type', 'color']);
    for (const row of parseTable(readEntryText(bytes, table('routes')!))) {
      if (!row.route_id) continue;
      const [index, isNew] = routes.intern(row.route_id);
      if (!isNew) continue;
      // MPK's live feed reports letter lines in lower case; GTFS upper. Keep one form.
      const shortName = (row.route_short_name || row.route_id).trim().toUpperCase();
      await routeInserter.add([index, row.route_id, shortName, row.route_long_name || null, intOrNull(row.route_type), row.route_color || null]);
    }
    await routeInserter.finish();

    report('stops', 0.02);
    const stopInserter = new BatchInserter(db, 'stops', ['stop_idx', 'stop_id', 'code', 'name', 'name_norm', 'lat', 'lon']);
    await streamTable(bytes, table('stops')!, async (fields, col) => {
      const id = fields[col('stop_id')];
      if (!id) return;
      // Stations and entrances are not where a vehicle stops.
      const locationType = fields[col('location_type')] ?? '';
      if (locationType !== '' && locationType !== '0') return;
      const [index, isNew] = stops.intern(id);
      if (!isNew) return;
      const name = (fields[col('stop_name')] ?? '').trim() || id;
      await stopInserter.add([
        index,
        id,
        fields[col('stop_code')] || null,
        name,
        normalizeSearch(name),
        floatOrNull(fields[col('stop_lat')]),
        floatOrNull(fields[col('stop_lon')]),
      ]);
    });
    await stopInserter.finish();

    report('calendar', 0.04);
    const calendarInserter = new BatchInserter(db, 'calendar', ['service_idx', 'days', 'start_date', 'end_date']);
    const calendarEntry = table('calendar');
    if (calendarEntry) {
      for (const row of parseTable(readEntryText(bytes, calendarEntry))) {
        if (!row.service_id) continue;
        const [index, isNew] = services.intern(row.service_id);
        if (!isNew) continue;
        let days = 0;
        WEEKDAY_COLUMNS.forEach((column, bit) => {
          if (row[column] === '1') days |= 1 << bit;
        });
        await calendarInserter.add([index, days, intOrNull(row.start_date) ?? 0, intOrNull(row.end_date) ?? 99_991_231]);
      }
    }
    await calendarInserter.finish();

    const exceptionInserter = new BatchInserter(db, 'calendar_dates', ['date', 'service_idx', 'exception_type'], 400, 'INSERT OR REPLACE');
    const datesEntry = table('calendar_dates');
    if (datesEntry) {
      await streamTable(bytes, datesEntry, async (fields, col) => {
        const serviceId = fields[col('service_id')];
        const date = intOrNull(fields[col('date')]);
        const type = intOrNull(fields[col('exception_type')]);
        if (!serviceId || !date || (type !== 1 && type !== 2)) return;
        const [index] = services.intern(serviceId);
        await exceptionInserter.add([date, index, type]);
      });
    }
    await exceptionInserter.finish();

    report('shapes', 0.06);
    const points = new Map<string, { seq: number; lat: number; lon: number }[]>();
    await streamTable(bytes, table('shapes')!, (fields, col) => {
      const id = fields[col('shape_id')];
      const lat = floatOrNull(fields[col('shape_pt_lat')]);
      const lon = floatOrNull(fields[col('shape_pt_lon')]);
      const seq = intOrNull(fields[col('shape_pt_sequence')]);
      if (!id || lat === null || lon === null || seq === null) return;
      let list = points.get(id);
      if (!list) points.set(id, (list = []));
      list.push({ seq, lat, lon });
    });
    const shapeInserter = new BatchInserter(db, 'shapes', ['shape_idx', 'shape_id', 'points'], 50);
    for (const [id, list] of points) {
      const [index] = shapes.intern(id);
      await shapeInserter.add([index, id, encodeShape(list)]);
    }
    await shapeInserter.finish();
    points.clear();

    report('trips', 0.1);
    const tripInserter = new BatchInserter(db, 'trips', [
      'trip_idx',
      'trip_id',
      'route_idx',
      'service_idx',
      'headsign',
      'direction',
      'shape_idx',
      'brigade',
      'vehicle_id',
    ]);
    await streamTable(bytes, table('trips')!, async (fields, col) => {
      const id = fields[col('trip_id')];
      const route = routes.get(fields[col('route_id')] ?? '');
      const serviceId = fields[col('service_id')];
      if (!id || route === undefined || !serviceId) return;
      const [index, isNew] = trips.intern(id);
      if (!isNew) return;
      const [service] = services.intern(serviceId);
      const shapeId = fields[col('shape_id')];
      await tripInserter.add([
        index,
        id,
        route,
        service,
        fields[col('trip_headsign')] || null,
        intOrNull(fields[col('direction_id')]),
        shapeId ? (shapes.get(shapeId) ?? null) : null,
        // Wrocław's feed carries these beyond the GTFS spec.
        fields[col('brigade_id')] || null,
        fields[col('vehicle_id')] || null,
      ]);
    });
    await tripInserter.finish();

    // Every service id is known once calendar, calendar_dates and trips are in.
    const serviceInserter = new BatchInserter(db, 'services', ['service_idx', 'service_id']);
    for (const [id, index] of services.entries()) await serviceInserter.add([index, id]);
    await serviceInserter.finish();
  });

  await db.transaction(async () => {
    const stopTimeInserter = new BatchInserter(db, 'stop_times', ['trip_idx', 'seq', 'stop_idx', 'arr', 'dep'], 500, 'INSERT OR IGNORE');
    await streamTable(
      bytes,
      table('stop_times')!,
      async (fields, col) => {
        const trip = trips.get(fields[col('trip_id')] ?? '');
        const stop = stops.get(fields[col('stop_id')] ?? '');
        const seq = intOrNull(fields[col('stop_sequence')]);
        if (trip === undefined || stop === undefined || seq === null) return;
        let arr = timeToSeconds(fields[col('arrival_time')]);
        let dep = timeToSeconds(fields[col('departure_time')]);
        if (arr < 0) arr = dep;
        if (dep < 0) dep = arr;
        // Untimed intermediate stops cannot be shown on a departure board.
        if (dep < 0) return;
        stopTimeCount += 1;
        await stopTimeInserter.add([trip, seq, stop, arr, dep]);
      },
      (fraction) => report('stop_times', 0.12 + fraction * 0.73),
    );
    await stopTimeInserter.finish();
  });

  report('index', 0.86);
  await db.exec('UPDATE trips SET last_seq = (SELECT MAX(seq) FROM stop_times WHERE stop_times.trip_idx = trips.trip_idx);');
  await db.exec(
    'INSERT OR IGNORE INTO stop_routes (stop_idx, route_idx) SELECT DISTINCT st.stop_idx, t.route_idx FROM stop_times st JOIN trips t ON t.trip_idx = st.trip_idx;',
  );
  report('index', 0.9);
  await db.exec(CREATE_INDEXES);

  const counts = {
    routes: routes.size,
    stops: stops.size,
    trips: trips.size,
    stopTimes: stopTimeCount,
    shapes: shapes.size,
  };
  const meta: [string, string | null][] = [
    ['schema_version', String(SCHEMA_VERSION)],
    ['source_url', source.url],
    ['source_name', source.name],
    ['feed_start', window ? String(window.start) : null],
    ['feed_end', window ? String(window.end) : null],
    ['imported_at', String(now)],
    ['counts', JSON.stringify(counts)],
  ];
  for (const [key, value] of meta) await db.run('INSERT INTO meta (key, value) VALUES (?, ?)', [key, value]);
  await db.exec('ANALYZE;');
  report('done', 1);

  return { window, counts };
};
