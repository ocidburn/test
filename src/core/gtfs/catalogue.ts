/**
 * Working out which GTFS archive to download.
 *
 * Ported from wroclaw-mpk-map (MIT, © 2025 kijmoshi), commit b11fe19 —
 * server/src/gtfs/catalogue.js. See NOTICE.
 *
 * Wrocław's data API does not expose "the current file". Dataset 6 lists
 * every dated snapshot, newest upload first, as bare file ids — and the list
 * contains timetables that only take effect in a few days. So nothing here
 * hardcodes a download URL, and the snapshot in force today is preferred over
 * the newest one.
 */
import { fetchJson, type FetchLike } from '../net/http';

export type CatalogueConfig = {
  /** The city's data API; dataset 6 is the public transport timetable. */
  catalogueUrl: string;
  /** Where a file id is downloaded from. */
  downloadBase: string;
  /** Legacy CKAN instances, tried after the data API. */
  ckanHosts: string[];
  ckanDataset: string;
  /** Static mirrors, tried last. */
  mirrors: string[];
  /** Only the newest ids can be the timetable in force. */
  maxFileLookups: number;
  /** Blind downloads to queue when no metadata endpoint answers. */
  maxIdDownloads: number;
  timeoutMs: number;
};

export const DEFAULT_CATALOGUE: CatalogueConfig = {
  catalogueUrl: 'https://api.open-data.cui.wroclaw.pl/od2/6/',
  downloadBase: 'https://open-data.cui.wroclaw.pl/hdb/download',
  ckanHosts: ['https://opendata.cui.wroclaw.pl', 'https://open-data.cui.wroclaw.pl'],
  ckanDataset: 'rozkladjazdytransportupublicznegoplik_data',
  mirrors: ['https://api.dane.gov.pl/resources/1823,rozklad-jazdy-transportu-publicznego-gtfs/file'],
  maxFileLookups: 12,
  maxIdDownloads: 4,
  timeoutMs: 20_000,
};

export type FeedEntry = { name: string | null; url: string; effectiveDate: number | null };
export type FeedCandidate = { name: string | null; url: string };

export const REQUIRED_TABLES = ['routes', 'trips', 'stops', 'stop_times', 'shapes'];

const CKAN_API_PATHS = ['/api/3/action/', '/api/action/'];

/**
 * Effective date from a snapshot name such as
 * `OtwartyWroclaw_rozklad_jazdy_GTFS_25072026` — DDMMYYYY.
 *
 * @returns UTC epoch ms of that date, or null
 */
export const effectiveDateFromName = (name: unknown): number | null => {
  const match = /(\d{2})(\d{2})(\d{4})(?!\d)/.exec(String(name ?? ''));
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return Date.UTC(year, month - 1, day);
};

const URL_KEYS = ['url', 'link', 'href', 'download', 'downloadurl', 'file', 'path'];
const NAME_KEYS = ['name', 'filename', 'nazwa', 'title', 'label'];

const pickKey = (node: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of Object.keys(node)) {
    if (!keys.includes(key.toLowerCase().replace(/[_\s-]/g, ''))) continue;
    const value = node[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
};

/**
 * Pull archive entries out of an arbitrary JSON payload: any object carrying
 * a URL-ish string next to a name-ish one. The portal's schema is not
 * documented, so key names are matched loosely rather than pinned.
 */
export const parseFileListing = (payload: unknown): FeedEntry[] => {
  const entries: FeedEntry[] = [];
  const seen = new Set<string>();

  const walk = (node: unknown, depth: number) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const record = node as Record<string, unknown>;

    const url = pickKey(record, URL_KEYS);
    const name = pickKey(record, NAME_KEYS) ?? url;
    if (url && /^https?:\/\//i.test(url) && !seen.has(url)) {
      const haystack = `${name} ${url} ${record.extension ?? record.rozszerzenie ?? ''}`;
      const looksLikeFeed = /gtfs/i.test(haystack) || /\.zip($|\?)/i.test(url) || /\bzip\b/i.test(haystack);
      // The dataset also publishes an XML timetable, which is not GTFS.
      if (looksLikeFeed && !/\bxml\b/i.test(haystack)) {
        seen.add(url);
        entries.push({ name, url, effectiveDate: effectiveDateFromName(name) });
      }
    }
    for (const value of Object.values(record)) walk(value, depth + 1);
  };

  walk(payload, 0);
  return entries;
};

/**
 * The latest effective date that has already arrived first, then older ones,
 * then undated, and future-dated snapshots only as a last resort.
 */
export const orderByEffectiveDate = (entries: FeedEntry[], now = Date.now()): FeedEntry[] => {
  const dated = entries.filter((entry) => entry.effectiveDate != null);
  const undated = entries.filter((entry) => entry.effectiveDate == null);
  const inForce = dated.filter((entry) => entry.effectiveDate! <= now).sort((a, b) => b.effectiveDate! - a.effectiveDate!);
  const future = dated.filter((entry) => entry.effectiveDate! > now).sort((a, b) => a.effectiveDate! - b.effectiveDate!);
  return [...inForce, ...undated, ...future];
};

/** GTFS zips in a CKAN resource list; the declared format is the signal, not the extension. */
export const pickZipResources = (resources: unknown): string[] => {
  if (!Array.isArray(resources)) return [];
  const scored: { url: string; score: number }[] = [];
  for (const resource of resources) {
    const url = resource?.url;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue;
    const fields = [resource.format, resource.mimetype, resource.name, resource.description, url]
      .filter((value) => typeof value === 'string')
      .join(' ');
    const isZip = /\bzip\b/i.test(fields) || /\.zip($|\?)/i.test(url);
    const isXml = /\bxml\b/i.test(`${resource.format ?? ''} ${resource.name ?? ''}`);
    if (!isZip || isXml) continue;
    scored.push({ url, score: /gtfs/i.test(fields) ? 0 : 1 });
  }
  scored.sort((a, b) => a.score - b.score);
  return [...new Set(scored.map((entry) => entry.url))];
};

/** `{id: 6, active: true, pliki: [119, 117, …]}` → [119, 117, …] */
export const fileIdsFrom = (payload: unknown): number[] => {
  if (!payload || typeof payload !== 'object') return [];
  for (const value of Object.values(payload)) {
    if (!Array.isArray(value) || !value.length) continue;
    if (value.every((item) => Number.isInteger(item) || /^\d+$/.test(String(item)))) return value.map(Number);
  }
  return [];
};

const fileEndpointsFor = (catalogueUrl: string, id: number | string) => {
  const base = new URL(catalogueUrl);
  return [
    new URL(`${id}/`, base).toString(),
    `${base.origin}/od2/pliki/${id}/`,
    `${base.origin}/od2/plik/${id}/`,
    `${base.origin}/od2/file/${id}/`,
  ];
};

type Deps = { fetchImpl?: FetchLike; log?: (message: string) => void };

/**
 * Resolve file ids into named entries. The first endpoint shape that answers
 * is reused for the remaining ids; ids without metadata are dropped here and
 * handled by the blind-download fallback in the caller.
 */
export const resolveFileEntries = async (
  ids: number[],
  config: CatalogueConfig,
  { fetchImpl }: Deps = {},
): Promise<FeedEntry[]> => {
  const entries: FeedEntry[] = [];
  let workingPattern: ((id: number) => string) | null = null;

  const probe = async (id: number) => {
    const urls = workingPattern ? [workingPattern(id)] : fileEndpointsFor(config.catalogueUrl, id);
    for (const [index, url] of urls.entries()) {
      try {
        const payload = await fetchJson<Record<string, unknown>>(url, { timeoutMs: config.timeoutMs, fetchImpl });
        const [parsed] = parseFileListing(payload);
        const name = parsed?.name ?? pickKey(payload ?? {}, NAME_KEYS);
        if (!name) continue;
        if (!workingPattern) {
          const template = fileEndpointsFor(config.catalogueUrl, '__ID__')[index];
          workingPattern = (fileId) => template.replace('__ID__', String(fileId));
        }
        return { name, url: parsed?.url ?? `${config.downloadBase}/${id}/` };
      } catch {
        // Try the next endpoint shape.
      }
    }
    return null;
  };

  const queue = ids.slice(0, config.maxFileLookups);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, Math.max(1, queue.length)) }, async () => {
    while (cursor < queue.length) {
      const id = queue[cursor];
      cursor += 1;
      const entry = await probe(id);
      if (entry) entries.push({ ...entry, effectiveDate: effectiveDateFromName(entry.name) });
    }
  });
  await Promise.all(workers);
  return entries;
};

/** The ordered list of archive URLs to try, best first. */
export const resolveFeedCandidates = async (
  config: CatalogueConfig = DEFAULT_CATALOGUE,
  { fetchImpl, log = () => {}, now = Date.now() }: Deps & { now?: number } = {},
): Promise<FeedCandidate[]> => {
  const candidates: FeedCandidate[] = [];

  try {
    const payload = await fetchJson(config.catalogueUrl, { timeoutMs: config.timeoutMs, fetchImpl });
    let listing = parseFileListing(payload);
    if (!listing.length) {
      const ids = fileIdsFrom(payload);
      if (ids.length) {
        listing = await resolveFileEntries(ids, config, { fetchImpl });
        if (!listing.length) {
          // No metadata endpoint answered. Ids are newest upload first and
          // every archive states its own dates, so the download step decides.
          log(`no file metadata; queueing ${config.maxIdDownloads} newest ids for download`);
          listing = ids.slice(0, config.maxIdDownloads).map((id) => ({
            name: null,
            url: `${config.downloadBase}/${id}/`,
            effectiveDate: null,
          }));
        }
      }
    }
    const ordered = orderByEffectiveDate(listing, now);
    if (!ordered.length) log(`catalogue ${config.catalogueUrl} returned no usable entries`);
    candidates.push(...ordered.map(({ name, url }) => ({ name, url })));
  } catch (error) {
    log(`catalogue lookup failed: ${(error as Error).message}`);
  }

  for (const host of config.ckanHosts) {
    for (const apiPath of CKAN_API_PATHS) {
      const url = `${host}${apiPath}package_show?id=${config.ckanDataset}`;
      try {
        const json = await fetchJson<{ result?: { resources?: unknown }; resources?: unknown }>(url, {
          timeoutMs: config.timeoutMs,
          fetchImpl,
        });
        const urls = pickZipResources(json?.result?.resources ?? json?.resources);
        if (!urls.length) continue;
        candidates.push(...urls.map((resourceUrl) => ({ name: null, url: resourceUrl })));
        break;
      } catch {
        // Next API path / host.
      }
    }
  }

  candidates.push(...config.mirrors.map((url) => ({ name: null, url })));

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
};
