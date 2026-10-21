/**
 * Line naming rules for Wrocław public transport.
 *
 * Ported from wroclaw-mpk-map (MIT, © 2025 kijmoshi), commit b11fe19 —
 * server/src/lines.js. See NOTICE.
 */

export type LineCategory =
  | 'tram'
  | 'tramSpecial'
  | 'tramTemporary'
  | 'bus'
  | 'busNight'
  | 'busSuburban'
  | 'busTemporary'
  | 'busZone'
  | 'busExpress'
  | 'busSpecial'
  | 'unknown';

const TRAM_CATEGORIES = new Set<LineCategory>(['tram', 'tramSpecial', 'tramTemporary']);
const EXPRESS_LINES = new Set(['A', 'C', 'D', 'K', 'N']);
/** Sightseeing / historic tram lines. */
const SPECIAL_TRAM_LINES = new Set(['0L', '0P', '23', '74']);

export const lineToType = (line: string): LineCategory => {
  const name = line.trim().toUpperCase();
  if (!name) return 'unknown';
  if (SPECIAL_TRAM_LINES.has(name)) return 'tramSpecial';
  if (EXPRESS_LINES.has(name)) return 'busExpress';
  // "T" prefixed lines are replacement trams announced during track works.
  if (/^T\d+$/.test(name)) return 'tramTemporary';
  if (/^\d+$/.test(name)) {
    const value = Number.parseInt(name, 10);
    if (value < 40) return 'tram';
    if (value >= 70 && value < 100) return 'tramTemporary';
    if (value >= 200 && value < 300) return 'busNight';
    if (value >= 600 && value < 700) return 'busSuburban';
    if (value >= 700 && value < 800) return 'busTemporary';
    if (value >= 900 && value < 1000) return 'busZone';
    return 'bus';
  }
  // "B" is the substitute-bus prefix ("bus za tramwaj").
  if (name.startsWith('B')) return 'busSpecial';
  return 'unknown';
};

/** GTFS route_type wins when present (0 tram, 3 bus); the name decides otherwise. */
export const isTramLine = (line: string, routeType?: number | null): boolean => {
  if (routeType === 0 || routeType === 900) return true;
  if (routeType === 3 || routeType === 700) return false;
  return TRAM_CATEGORIES.has(lineToType(line));
};

/** Natural order: "4" before "10", numbers before letters. */
export const compareLines = (a: string, b: string): number => {
  const aNum = /^\d+$/.test(a) ? Number.parseInt(a, 10) : null;
  const bNum = /^\d+$/.test(b) ? Number.parseInt(b, 10) : null;
  if (aNum !== null && bNum !== null) return aNum - bNum;
  if (aNum !== null) return -1;
  if (bNum !== null) return 1;
  return a.localeCompare(b);
};

/** The marker body for a line: shape tells the kind apart even without colour. */
export type MarkerKind = 'tram' | 'bus' | 'express' | 'night' | 'suburban';

export const markerKind = (line: string, tram: boolean): MarkerKind => {
  if (tram) return 'tram';
  const type = lineToType(line);
  if (type === 'busNight') return 'night';
  if (type === 'busExpress') return 'express';
  if (type === 'busSuburban' || type === 'busZone') return 'suburban';
  return 'bus';
};
