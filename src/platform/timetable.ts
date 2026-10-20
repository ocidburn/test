import { File, Paths } from 'expo-file-system';

import type { Db } from '../core/db';
import { DEFAULT_CATALOGUE, resolveFeedCandidates } from '../core/gtfs/catalogue';
import { importGtfs, type ImportProgress } from '../core/gtfs/importer';
import { isCurrentSchema, readMeta, type TimetableMeta } from '../core/gtfs/queries';
import { decideUpdate, type KnownSnapshot } from '../core/gtfs/update';
import { USER_AGENT } from '../core/net/http';
import { deleteExpoDb, openExpoDb } from './expo-db';

/**
 * Owns the timetable database file on the phone: which one is current,
 * finding and importing a newer snapshot, and swapping it in.
 *
 * A new snapshot is imported into a new file while the old one keeps
 * serving; only a completed import replaces it. If the city portal is down,
 * the last imported timetable simply stays.
 */

type StoredState = {
  dbName: string | null;
  sourceUrl: string | null;
  checkedAt: number | null;
  known: Record<string, KnownSnapshot>;
};

const STATE_FILE = 'timetable-state.json';
const DOWNLOAD_FILE = 'gtfs-download.zip';
const DOWNLOAD_TIMEOUT_MS = 180_000;
/** Re-check the catalogue at most this often unless asked to. */
export const CHECK_INTERVAL_MS = 12 * 3_600_000;

const emptyState = (): StoredState => ({ dbName: null, sourceUrl: null, checkedAt: null, known: {} });

const stateFile = () => new File(Paths.document, STATE_FILE);

const readState = (): StoredState => {
  try {
    const file = stateFile();
    if (!file.exists) return emptyState();
    return { ...emptyState(), ...JSON.parse(file.textSync()) };
  } catch {
    return emptyState();
  }
};

const writeState = (state: StoredState) => {
  const file = stateFile();
  if (!file.exists) file.create();
  file.write(JSON.stringify(state));
};

const downloadBytes = async (url: string, onProgress?: (fraction: number) => void): Promise<Uint8Array> => {
  const target = new File(Paths.cache, DOWNLOAD_FILE);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const file = await File.downloadFileAsync(url, target, {
      idempotent: true,
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (totalBytes > 0) onProgress?.(bytesWritten / totalBytes);
      },
    });
    return await file.bytes();
  } finally {
    clearTimeout(timer);
    try {
      if (target.exists) target.delete();
    } catch {
      // A leftover download in the cache directory is harmless.
    }
  }
};

export type Opened = { db: Db; meta: TimetableMeta };

/** Open the installed timetable, or null if there is none (or it is from an older schema). */
export const openInstalled = async (): Promise<Opened | null> => {
  const state = readState();
  if (!state.dbName) return null;
  try {
    const db = await openExpoDb(state.dbName);
    const meta = await readMeta(db);
    if (!isCurrentSchema(meta)) {
      await db.close();
      writeState({ ...state, dbName: null, sourceUrl: null, checkedAt: null });
      await deleteExpoDb(state.dbName);
      return null;
    }
    return { db, meta };
  } catch {
    return null;
  }
};

export const lastCheckedAt = () => readState().checkedAt;

export type UpdateProgress =
  | { stage: 'checking' }
  | { stage: 'downloading'; fraction: number | null }
  | { stage: 'importing'; progress: ImportProgress };

export type UpdateResult =
  | { updated: false; reason: string }
  | { updated: true; opened: Opened; replaced: string | null };

/**
 * Look for a better snapshot and import it. The caller closes the previous
 * database (after switching to the new one) and then calls `dropDatabase`
 * with `replaced`.
 */
export const updateTimetable = async ({
  onProgress = () => {},
  log = () => {},
}: { onProgress?: (progress: UpdateProgress) => void; log?: (message: string) => void } = {}): Promise<UpdateResult> => {
  const state = readState();
  onProgress({ stage: 'checking' });
  const candidates = await resolveFeedCandidates(DEFAULT_CATALOGUE, { log });

  const decision = await decideUpdate({
    candidates,
    currentUrl: state.dbName ? state.sourceUrl : null,
    known: state.known,
    log,
    download: (url) => {
      onProgress({ stage: 'downloading', fraction: null });
      return downloadBytes(url, (fraction) => onProgress({ stage: 'downloading', fraction }));
    },
  });

  const checked: StoredState = { ...state, checkedAt: Date.now(), known: decision.known };
  if (decision.action === 'keep') {
    writeState(checked);
    return { updated: false, reason: decision.reason };
  }

  const dbName = `gtfs-${Date.now()}.db`;
  const db = await openExpoDb(dbName);
  try {
    await importGtfs(decision.bytes, db, {
      source: decision.candidate,
      onProgress: (progress) => onProgress({ stage: 'importing', progress }),
    });
    await db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = NORMAL;');
  } catch (error) {
    await db.close().catch(() => {});
    await deleteExpoDb(dbName);
    writeState(checked);
    throw error;
  }

  writeState({ ...checked, dbName, sourceUrl: decision.candidate.url });
  return { updated: true, opened: { db, meta: await readMeta(db) }, replaced: state.dbName };
};

export const dropDatabase = (name: string | null) => (name ? deleteExpoDb(name) : Promise.resolve());

export const needsCheck = (now = Date.now()) => {
  const checkedAt = lastCheckedAt();
  return checkedAt === null || now - checkedAt > CHECK_INTERVAL_MS;
};
