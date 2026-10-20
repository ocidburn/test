import { assertComplete, isInForce, readEffectiveWindow } from '../src/core/gtfs/archive';
import {
  DEFAULT_CATALOGUE,
  effectiveDateFromName,
  fileIdsFrom,
  orderByEffectiveDate,
  parseFileListing,
  pickZipResources,
  resolveFeedCandidates,
} from '../src/core/gtfs/catalogue';
import { readZipDirectory } from '../src/core/gtfs/zip';
import { buildFixtureZip } from './fixtures/gtfs';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('snapshot selection', () => {
  test('names carry DDMMYYYY', () => {
    expect(effectiveDateFromName('OtwartyWroclaw_rozklad_jazdy_GTFS_25072026')).toBe(Date.UTC(2026, 6, 25));
    expect(effectiveDateFromName('GTFS_99999999')).toBeNull();
    expect(effectiveDateFromName(null)).toBeNull();
  });

  test('the snapshot in force beats a newer future-dated one (observed 2026-07-31)', () => {
    const entries = parseFileListing([
      { name: 'GTFS_01082026', url: 'https://x/1.zip' },
      { name: 'GTFS_25072026', url: 'https://x/2.zip' },
      { name: 'GTFS_18072026', url: 'https://x/3.zip' },
      { name: 'rozklad XML', url: 'https://x/4.zip', extension: 'xml' },
    ]);
    expect(entries).toHaveLength(3);
    const july31 = Date.UTC(2026, 6, 31, 10);
    expect(orderByEffectiveDate(entries, july31).map((entry) => entry.name)).toEqual([
      'GTFS_25072026',
      'GTFS_18072026',
      'GTFS_01082026',
    ]);
    const august1 = Date.UTC(2026, 7, 1, 10);
    expect(orderByEffectiveDate(entries, august1)[0].name).toBe('GTFS_01082026');
  });

  test('dataset payload lists bare ids', () => {
    expect(fileIdsFrom({ id: 6, active: true, pliki: [119, 117, '121'] })).toEqual([119, 117, 121]);
    expect(fileIdsFrom({ id: 6 })).toEqual([]);
  });

  test('CKAN resources: zip by declared format, XML excluded', () => {
    expect(
      pickZipResources([
        { url: 'https://h/xml', format: 'ZIP', name: 'rozkład XML' },
        { url: 'https://h/other', format: 'ZIP' },
        { url: 'https://h/gtfs', format: 'zip', name: 'GTFS' },
        { url: 'ftp://nope', format: 'zip' },
      ]),
    ).toEqual(['https://h/gtfs', 'https://h/other']);
  });

  test('ids with no metadata endpoint fall back to blind downloads, then CKAN and mirrors', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (url === DEFAULT_CATALOGUE.catalogueUrl) return jsonResponse({ id: 6, pliki: [121, 119, 117, 115, 113] });
      return jsonResponse('<html>not found</html>', 404);
    });
    const candidates = await resolveFeedCandidates(DEFAULT_CATALOGUE, { fetchImpl });
    expect(candidates.map((candidate) => candidate.url)).toEqual([
      'https://open-data.cui.wroclaw.pl/hdb/download/121/',
      'https://open-data.cui.wroclaw.pl/hdb/download/119/',
      'https://open-data.cui.wroclaw.pl/hdb/download/117/',
      'https://open-data.cui.wroclaw.pl/hdb/download/115/',
      ...DEFAULT_CATALOGUE.mirrors,
    ]);
  });

  test('resolved file names are ordered by effective date', async () => {
    const names: Record<number, string> = { 121: 'GTFS_01082026', 119: 'GTFS_25072026' };
    const fetchImpl = jest.fn(async (url: string) => {
      if (url === DEFAULT_CATALOGUE.catalogueUrl) return jsonResponse({ id: 6, pliki: [121, 119] });
      const match = /od2\/6\/(\d+)\/$/.exec(url);
      if (match) return jsonResponse({ nazwa: names[Number(match[1])] });
      return jsonResponse({}, 404);
    });
    const candidates = await resolveFeedCandidates(DEFAULT_CATALOGUE, { fetchImpl, now: Date.UTC(2026, 6, 31) });
    expect(candidates.slice(0, 2)).toEqual([
      { name: 'GTFS_25072026', url: 'https://open-data.cui.wroclaw.pl/hdb/download/119/' },
      { name: 'GTFS_01082026', url: 'https://open-data.cui.wroclaw.pl/hdb/download/121/' },
    ]);
  });
});

describe('archive checks', () => {
  test('a snapshot without shapes is rejected, also when nested in a folder', () => {
    expect(() => assertComplete(readZipDirectory(buildFixtureZip({ omit: ['shapes.txt'] })))).toThrow(/shapes\.txt/);
    expect(() => assertComplete(readZipDirectory(buildFixtureZip({ prefix: 'GTFS/' })))).not.toThrow();
  });

  test('feed_info states the window; calendar bounds it otherwise', () => {
    const withInfo = buildFixtureZip({ feedDates: { start: '20260801', end: '20260831' } });
    expect(readEffectiveWindow(withInfo, readZipDirectory(withInfo))).toEqual({ start: 20260801, end: 20260831 });
    const plain = buildFixtureZip();
    expect(readEffectiveWindow(plain, readZipDirectory(plain))).toEqual({ start: 20260601, end: 20261231 });
  });

  test('in force uses the Wrocław date', () => {
    const window = { start: 20260801, end: 20260831 };
    // 22:30 UTC on 31 July is already 1 August in Wrocław.
    expect(isInForce(window, Date.parse('2026-07-31T22:30:00Z'))).toBe(true);
    expect(isInForce(window, Date.parse('2026-07-31T21:30:00Z'))).toBe(false);
    expect(isInForce(null)).toBe(true);
  });
});
