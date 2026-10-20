import { decideUpdate } from '../src/core/gtfs/update';
import { buildFixtureZip } from './fixtures/gtfs';

const now = Date.parse('2026-07-31T10:00:00+02:00');
const current = buildFixtureZip({ feedDates: { start: '20260725', end: '20260831' } });
const future = buildFixtureZip({ feedDates: { start: '20260801', end: '20260831' } });
const noShapes = buildFixtureZip({ omit: ['shapes.txt'] });

const downloader = (files: Record<string, Uint8Array>) =>
  jest.fn(async (url: string) => {
    const bytes = files[url];
    if (!bytes) throw new Error('HTTP 404');
    return bytes;
  });

describe('decideUpdate', () => {
  test('skips a future snapshot and imports the one in force', async () => {
    const download = downloader({ '/121/': future, '/119/': current });
    const decision = await decideUpdate({
      candidates: [{ url: '/121/', name: null }, { url: '/119/', name: null }],
      download,
      currentUrl: null,
      known: {},
      now,
    });
    expect(decision.action).toBe('import');
    expect(decision.action === 'import' && decision.candidate.url).toBe('/119/');
    expect(decision.known['/121/']).toEqual({ window: { start: 20260801, end: 20260831 } });
  });

  test('keeps the installed timetable and remembers what it learned', async () => {
    const download = downloader({ '/121/': future, '/120/': noShapes });
    const decision = await decideUpdate({
      candidates: [{ url: '/121/', name: null }, { url: '/120/', name: null }, { url: '/119/', name: null }],
      download,
      currentUrl: '/119/',
      known: {},
      now,
    });
    expect(decision.action).toBe('keep');
    expect(download).toHaveBeenCalledTimes(2);
    expect(decision.known['/120/']).toEqual({ invalid: 'incomplete feed, missing shapes.txt' });

    // Next check: neither is downloaded again before 1 August.
    const again = downloader({});
    await decideUpdate({
      candidates: [{ url: '/121/', name: null }, { url: '/120/', name: null }, { url: '/119/', name: null }],
      download: again,
      currentUrl: '/119/',
      known: decision.known,
      now,
    });
    expect(again).not.toHaveBeenCalled();
  });

  test('on its start date the remembered future snapshot is fetched again and wins', async () => {
    const download = downloader({ '/121/': future });
    const decision = await decideUpdate({
      candidates: [{ url: '/121/', name: null }, { url: '/119/', name: null }],
      download,
      currentUrl: '/119/',
      known: { '/121/': { window: { start: 20260801, end: 20260831 } } },
      now: Date.parse('2026-08-01T04:00:00+02:00'),
    });
    expect(decision.action === 'import' && decision.candidate.url).toBe('/121/');
  });

  test('with no timetable at all, a future snapshot beats nothing', async () => {
    const decision = await decideUpdate({
      candidates: [{ url: '/121/', name: null }, { url: '/x/', name: null }],
      download: downloader({ '/121/': future }),
      currentUrl: null,
      known: {},
      now,
    });
    expect(decision.action === 'import' && decision.candidate.url).toBe('/121/');
  });

  test('a non-zip answer is rejected but retried next time', async () => {
    const html = new TextEncoder().encode('<html>' + ' '.repeat(4000));
    const decision = await decideUpdate({
      candidates: [{ url: '/a/', name: null }],
      download: downloader({ '/a/': html }),
      currentUrl: null,
      known: {},
      now,
    });
    expect(decision).toMatchObject({ action: 'keep', reason: 'no usable snapshot found' });
    expect(decision.known['/a/']).toBeUndefined();
  });
});
