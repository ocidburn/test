import { DecodeUTF8, Inflate, inflateSync, strFromU8 } from 'fflate';

/**
 * Just enough of the ZIP format to read a GTFS archive entry by entry.
 *
 * fflate's own streaming unzip decompresses everything inside one synchronous
 * push, which would hold all of stop_times.txt (~100 MB of text) in memory
 * before a single row reached the database. Reading the central directory
 * here lets each entry be inflated in slices, with the caller awaiting its
 * database writes between them.
 */

export type ZipEntry = {
  /** Full path inside the archive, e.g. `GTFS/stops.txt`. */
  path: string;
  /** Lower-cased file name without any directory. */
  baseName: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const u16 = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8);
const u32 = (bytes: Uint8Array, at: number) =>
  (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;

/** Zip archives start with "PK". An HTML error page does not. */
export const looksLikeZip = (bytes: Uint8Array) => bytes.length > 1024 && bytes[0] === 0x50 && bytes[1] === 0x4b;

export const readZipDirectory = (bytes: Uint8Array): ZipEntry[] => {
  // The end-of-central-directory record sits in the last 22 bytes plus an
  // optional comment of up to 64 KB.
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at -= 1) {
    if (u32(bytes, at) === EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive (no end of central directory)');

  const count = u16(bytes, eocd + 10);
  let at = u32(bytes, eocd + 16);
  if (at === 0xffffffff) throw new Error('ZIP64 archives are not supported');

  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (u32(bytes, at) !== CENTRAL_SIGNATURE) throw new Error('corrupt zip central directory');
    const method = u16(bytes, at + 10);
    const compressedSize = u32(bytes, at + 20);
    const size = u32(bytes, at + 24);
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    const localHeaderOffset = u32(bytes, at + 42);
    const path = strFromU8(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    if (path.endsWith('/')) continue;
    entries.push({
      path,
      baseName: path.replace(/^.*\//, '').toLowerCase(),
      method,
      compressedSize,
      size,
      localHeaderOffset,
    });
  }
  return entries;
};

/**
 * Find a table by file name, ignoring any directory.
 *
 * Some publishers nest the tables in a folder (`GTFS/shapes.txt`); an
 * exact-path lookup misses that layout and the feed then looks incomplete.
 */
export const findEntry = (entries: ZipEntry[], fileName: string): ZipEntry | null => {
  const wanted = fileName.toLowerCase();
  return entries.find((entry) => entry.baseName === wanted) ?? null;
};

const compressedData = (bytes: Uint8Array, entry: ZipEntry) => {
  const at = entry.localHeaderOffset;
  if (u32(bytes, at) !== LOCAL_SIGNATURE) throw new Error(`corrupt zip local header for ${entry.path}`);
  const start = at + 30 + u16(bytes, at + 26) + u16(bytes, at + 28);
  return bytes.subarray(start, start + entry.compressedSize);
};

const assertMethod = (entry: ZipEntry) => {
  if (entry.method !== 0 && entry.method !== 8) {
    throw new Error(`unsupported compression method ${entry.method} for ${entry.path}`);
  }
};

/** A whole (small) entry as text. */
export const readEntryText = (bytes: Uint8Array, entry: ZipEntry): string => {
  assertMethod(entry);
  const data = compressedData(bytes, entry);
  const raw = entry.method === 0 ? data : inflateSync(data, { out: new Uint8Array(entry.size) });
  return strFromU8(raw);
};

/**
 * Stream an entry as text, `sliceBytes` of compressed input at a time. The
 * callback receives each decoded piece and is awaited before the next slice
 * is inflated, so a slow consumer bounds memory instead of growing it.
 */
export const streamEntryText = async (
  bytes: Uint8Array,
  entry: ZipEntry,
  onText: (text: string) => Promise<void> | void,
  { sliceBytes = 128 * 1024, onProgress }: { sliceBytes?: number; onProgress?: (fraction: number) => void } = {},
): Promise<void> => {
  assertMethod(entry);
  const data = compressedData(bytes, entry);

  const pending: string[] = [];
  const decoder = new DecodeUTF8((text) => {
    if (text) pending.push(text);
  });
  const inflater = new Inflate((chunk, final) => decoder.push(chunk, final));
  const sink = entry.method === 0 ? (chunk: Uint8Array, final: boolean) => decoder.push(chunk, final) : (chunk: Uint8Array, final: boolean) => inflater.push(chunk, final);

  if (data.length === 0) sink(new Uint8Array(0), true);
  for (let offset = 0; offset < data.length; offset += sliceBytes) {
    const end = Math.min(data.length, offset + sliceBytes);
    sink(data.subarray(offset, end), end === data.length);
    while (pending.length) await onText(pending.shift()!);
    onProgress?.(end / data.length);
  }
  while (pending.length) await onText(pending.shift()!);
};
