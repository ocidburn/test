/**
 * Checks on a downloaded archive before it is imported.
 *
 * Ported from wroclaw-mpk-map (MIT, © 2025 kijmoshi), commit b11fe19 —
 * server/src/gtfs/archive.js. See NOTICE.
 */
import { warsawDateKey } from '../time/warsaw';
import { REQUIRED_TABLES } from './catalogue';
import { parseTable } from './csv';
import { findEntry, readEntryText, type ZipEntry } from './zip';

/**
 * The city's archive interleaves complete snapshots with short ones that can
 * lack shapes.txt — a map with vehicles and no routes, which looks like a
 * rendering bug. A header-only table is as useless as an absent one.
 */
export const assertComplete = (entries: ZipEntry[]): void => {
  const missing = REQUIRED_TABLES.filter((table) => {
    const entry = findEntry(entries, `${table}.txt`);
    return !entry || entry.size < 64;
  });
  if (missing.length) {
    throw new Error(`incomplete feed, missing ${missing.map((table) => `${table}.txt`).join(', ')}`);
  }
};

export type FeedWindow = { start: number; end: number };

const asDateKey = (value: string | undefined) => (value && /^\d{8}$/.test(value) ? Number(value) : null);

/**
 * When the feed is valid, as stated by the feed itself: feed_info.txt, or
 * the span of calendar.txt. Filenames are only a convention.
 */
export const readEffectiveWindow = (bytes: Uint8Array, entries: ZipEntry[]): FeedWindow | null => {
  const info = findEntry(entries, 'feed_info.txt');
  if (info) {
    const [row] = parseTable(readEntryText(bytes, info));
    const start = asDateKey(row?.feed_start_date);
    const end = asDateKey(row?.feed_end_date);
    if (start && end) return { start, end };
  }

  const calendar = findEntry(entries, 'calendar.txt');
  if (!calendar) return null;
  let start: number | null = null;
  let end: number | null = null;
  for (const row of parseTable(readEntryText(bytes, calendar))) {
    const rowStart = asDateKey(row.start_date);
    const rowEnd = asDateKey(row.end_date);
    if (rowStart && (start === null || rowStart < start)) start = rowStart;
    if (rowEnd && (end === null || rowEnd > end)) end = rowEnd;
  }
  return start && end ? { start, end } : null;
};

/** In force today? A feed that states no dates at all counts as in force. */
export const isInForce = (window: FeedWindow | null, now = Date.now()): boolean => {
  if (!window) return true;
  const today = warsawDateKey(now);
  return window.start <= today && today <= window.end;
};
