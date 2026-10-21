/**
 * Web Mercator tile arithmetic for offline packages: which tiles cover an
 * area, and the URL of each, for XYZ templates and for WMS ones (whose
 * box is the tile's extent in EPSG:3857 metres, as react-native-maps
 * computes it).
 */

export type LonLatBox = { west: number; south: number; east: number; north: number };
export type TileXYZ = { z: number; x: number; y: number };

/** Wrocław within its city limits, with a little margin. */
export const WROCLAW_BOX: LonLatBox = { west: 16.8, south: 51.04, east: 17.18, north: 51.22 };

const HALF_WORLD = 20037508.342789244;

const clampLat = (lat: number) => Math.max(-85.05112878, Math.min(85.05112878, lat));

export const tileX = (lon: number, z: number) => Math.min(2 ** z - 1, Math.max(0, Math.floor(((lon + 180) / 360) * 2 ** z)));

export const tileY = (lat: number, z: number) => {
  const rad = (clampLat(lat) * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
  return Math.min(2 ** z - 1, Math.max(0, y));
};

/** Tile ranges covering a box, for each zoom from minZ to maxZ. */
export const tileRanges = (box: LonLatBox, minZ: number, maxZ: number) => {
  const ranges: { z: number; x0: number; x1: number; y0: number; y1: number }[] = [];
  for (let z = minZ; z <= maxZ; z += 1) {
    ranges.push({ z, x0: tileX(box.west, z), x1: tileX(box.east, z), y0: tileY(box.north, z), y1: tileY(box.south, z) });
  }
  return ranges;
};

export const countTiles = (box: LonLatBox, minZ: number, maxZ: number) =>
  tileRanges(box, minZ, maxZ).reduce((sum, r) => sum + (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1), 0);

export function* tilesIn(box: LonLatBox, minZ: number, maxZ: number): Generator<TileXYZ> {
  for (const r of tileRanges(box, minZ, maxZ)) {
    for (let x = r.x0; x <= r.x1; x += 1) for (let y = r.y0; y <= r.y1; y += 1) yield { z: r.z, x, y };
  }
}

/** A tile's extent in EPSG:3857 metres: minX, minY, maxX, maxY. */
export const tileBox3857 = ({ z, x, y }: TileXYZ): [number, number, number, number] => {
  const size = (2 * HALF_WORLD) / 2 ** z;
  const minX = -HALF_WORLD + x * size;
  const maxY = HALF_WORLD - y * size;
  return [minX, maxY - size, minX + size, maxY];
};

/** The URL of one tile from an XYZ or WMS template. */
export const tileUrl = (template: string, kind: 'xyz' | 'wms', tile: TileXYZ, size = 256): string => {
  if (kind === 'xyz') return template.replaceAll('{z}', String(tile.z)).replaceAll('{x}', String(tile.x)).replaceAll('{y}', String(tile.y));
  const [minX, minY, maxX, maxY] = tileBox3857(tile);
  return template
    .replace('{minX}', String(minX))
    .replace('{minY}', String(minY))
    .replace('{maxX}', String(maxX))
    .replace('{maxY}', String(maxY))
    .replace('{width}', String(size))
    .replace('{height}', String(size));
};

/** Whether downloaded bytes are an image (JPEG, PNG, WebP) and not a server's error page. */
export const looksLikeImage = (bytes: Uint8Array) =>
  (bytes[0] === 0xff && bytes[1] === 0xd8) ||
  (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) ||
  (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46);
