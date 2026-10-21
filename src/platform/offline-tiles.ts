import { Directory, File, Paths } from 'expo-file-system';

import { USER_AGENT } from '../core/net/http';
import { countTiles, looksLikeImage, tileUrl, tilesIn, type LonLatBox, type TileXYZ } from '../core/map/tiles';

/**
 * Offline tile packages. Tiles go where the map's tile overlay keeps its
 * cache ({id}/{z}/{x}/{y}, no extension), in the documents folder so iOS
 * does not purge them; the overlay then serves them from the phone and,
 * with no max age, never asks the server for them again.
 */

export type OfflinePackage = {
  id: string;
  box: LonLatBox;
  minZ: number;
  maxZ: number;
  tiles: number;
  saved: number;
  failed: number;
  bytes: number;
  finishedAt: number | null;
};

export type Progress = { done: number; total: number; failed: number; bytes: number };

/** Two at a time: these are public servers, not a CDN. */
const PARALLEL = 2;
const META = 'package.json';

export const tileDirectory = (id: string) => new Directory(Paths.document, 'tiles', id);

export const readPackage = (id: string): OfflinePackage | null => {
  try {
    const file = new File(tileDirectory(id), META);
    return file.exists ? (JSON.parse(file.textSync()) as OfflinePackage) : null;
  } catch {
    return null;
  }
};

const writePackage = (pkg: OfflinePackage) => {
  const dir = tileDirectory(pkg.id);
  dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, META);
  if (!file.exists) file.create();
  file.write(JSON.stringify(pkg));
};

export const deletePackage = (id: string) => {
  const dir = tileDirectory(id);
  if (dir.exists) dir.delete();
};

/**
 * Download every tile of `box` from `minZ` to `maxZ`. Tiles already on the
 * phone are kept, so an interrupted download resumes where it stopped. An
 * answer that is not an image (a WMS error page) is dropped and counted as
 * failed. Resolves with the package as saved, also when cancelled.
 */
export const downloadPackage = async (
  {
    id,
    template,
    kind,
    box,
    minZ,
    maxZ,
  }: { id: string; template: string; kind: 'xyz' | 'wms'; box: LonLatBox; minZ: number; maxZ: number },
  { signal, onProgress }: { signal: AbortSignal; onProgress: (progress: Progress) => void },
): Promise<OfflinePackage> => {
  const total = countTiles(box, minZ, maxZ);
  const pkg: OfflinePackage = { id, box, minZ, maxZ, tiles: total, saved: 0, failed: 0, bytes: 0, finishedAt: null };
  writePackage(pkg);
  const root = tileDirectory(id);
  const queue = tilesIn(box, minZ, maxZ);
  let done = 0;

  const fetchOne = async (tile: TileXYZ) => {
    const dir = new Directory(root, String(tile.z), String(tile.x));
    const file = new File(dir, String(tile.y));
    if (file.exists && (file.size ?? 0) > 0) {
      pkg.saved += 1;
      pkg.bytes += file.size ?? 0;
      return;
    }
    dir.create({ intermediates: true, idempotent: true });
    try {
      await File.downloadFileAsync(tileUrl(template, kind, tile), file, { idempotent: true, signal, headers: { 'User-Agent': USER_AGENT } });
      const bytes = await file.bytes();
      if (!looksLikeImage(bytes)) throw new Error('not an image');
      pkg.saved += 1;
      pkg.bytes += bytes.length;
    } catch (error) {
      if (file.exists) file.delete();
      if (signal.aborted) throw error;
      pkg.failed += 1;
    }
  };

  const worker = async () => {
    for (let next = queue.next(); !next.done && !signal.aborted; next = queue.next()) {
      await fetchOne(next.value).catch(() => {});
      done += 1;
      if (done % 20 === 0 || done === total) {
        onProgress({ done, total, failed: pkg.failed, bytes: pkg.bytes });
        writePackage(pkg);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  if (!signal.aborted) pkg.finishedAt = Date.now();
  writePackage(pkg);
  onProgress({ done, total, failed: pkg.failed, bytes: pkg.bytes });
  return pkg;
};
