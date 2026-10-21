/**
 * MPK Wrocław's live positions: `POST https://mpk.wroc.pl/bus_position`.
 *
 * Request and normalisation rules ported from wroclaw-mpk-map (MIT,
 * © 2025 kijmoshi), commit b11fe19 — server/src/vehicles.js. See NOTICE.
 *
 * The endpoint is undocumented. It answers `[{x, y, name, k, type}]` where
 * `x` is the latitude, and it answers `200 []` — not an error — to a body it
 * does not understand. Two body encodings are in circulation, so both are
 * tried and the one that works is remembered.
 */
import { request, type FetchLike } from '../net/http';
import { inArea, type LiveVehicle } from './types';

export const MPK_URL = 'https://mpk.wroc.pl/bus_position';

export type LineSets = { trams: string[]; buses: string[] };
export type Encoding = 'typed' | 'flat';

/**
 * Letter lines are upper case in GTFS and lower case on MPK's side; send
 * both spellings so neither convention drops them (duplicates are merged by id).
 */
const spellings = (line: string) => (/[A-Z]/.test(line) ? [line, line.toLowerCase()] : [line]);

export const buildBody = (encoding: Encoding, lines: LineSets): string => {
  const body = new URLSearchParams();
  if (encoding === 'typed') {
    for (const line of lines.buses) for (const name of spellings(line)) body.append('busList[bus][]', name);
    for (const line of lines.trams) for (const name of spellings(line)) body.append('busList[tram][]', name);
  } else {
    for (const line of [...lines.trams, ...lines.buses]) for (const name of spellings(line)) body.append('busList[][]', name);
  }
  return body.toString();
};

const FIELD_ALIASES = {
  lat: ['x', 'lat', 'latitude', 'szerokosc'],
  lon: ['y', 'lon', 'lng', 'longitude', 'dlugosc'],
  line: ['name', 'line', 'linia', 'route_short_name', 'nazwa_linii'],
  id: ['k', 'id', 'vehicle_id', 'nr_boczny'],
};

const pick = (row: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

export const normalizeMpkRow = (
  row: unknown,
  { now, isTram }: { now: number; isTram: (line: string, hint: string | null) => boolean },
): LiveVehicle | null => {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const lat = Number.parseFloat(String(pick(record, FIELD_ALIASES.lat)));
  const lon = Number.parseFloat(String(pick(record, FIELD_ALIASES.lon)));
  if (!inArea(lat, lon)) return null;
  const line = String(pick(record, FIELD_ALIASES.line) ?? '').trim().toUpperCase();
  if (!line) return null;
  const rawId = pick(record, FIELD_ALIASES.id);
  const hint = typeof record.type === 'string' ? record.type : null;
  return {
    // Without a vehicle key the id cannot survive a move; such rows are rare.
    id: rawId !== undefined ? `mpk:${line}-${rawId}` : `mpk:${line}-${lat.toFixed(4)}-${lon.toFixed(4)}`,
    line,
    tram: isTram(line, hint),
    lat,
    lon,
    heading: null,
    source: 'mpk',
    vehicleNumber: null,
    brigade: null,
    headsign: null,
    tripId: null,
    delaySeconds: null,
    positionAt: now,
  };
};

export type MpkResult = { vehicles: LiveVehicle[]; encoding: Encoding };

export const fetchMpk = async (
  lines: LineSets,
  {
    preferred = null,
    fetchImpl,
    now = Date.now(),
    isTram,
    timeoutMs = 10_000,
  }: {
    preferred?: Encoding | null;
    fetchImpl?: FetchLike;
    now?: number;
    isTram: (line: string, hint: string | null) => boolean;
    timeoutMs?: number;
  },
): Promise<MpkResult> => {
  const order: Encoding[] = preferred === 'flat' ? ['flat', 'typed'] : ['typed', 'flat'];
  const errors: string[] = [];
  for (const encoding of order) {
    try {
      const payload = await request(
        MPK_URL,
        async (response) => {
          const text = await response.text();
          // A cut-off or empty answer is a server-side failure; say so plainly.
          if (!text.trim()) throw new Error(`empty body (HTTP ${response.status})`);
          try {
            return JSON.parse(text) as unknown;
          } catch {
            throw new Error(`not JSON (HTTP ${response.status}): ${text.slice(0, 40).replace(/\s+/g, ' ')}`);
          }
        },
        {
          method: 'POST',
          timeoutMs,
          fetchImpl,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Accept: 'application/json' },
          body: buildBody(encoding, lines),
        },
      );
      const rows = Array.isArray(payload)
        ? payload
        : ((payload as Record<string, unknown> | null)?.vehicles ?? (payload as Record<string, unknown> | null)?.data);
      if (!Array.isArray(rows)) throw new Error('response did not contain a list of vehicles');
      // An empty list is how this endpoint says "I did not understand the body".
      if (!rows.length) throw new Error('empty list');
      const byId = new Map<string, LiveVehicle>();
      for (const row of rows) {
        const vehicle = normalizeMpkRow(row, { now, isTram });
        if (vehicle) byId.set(vehicle.id, vehicle);
      }
      return { vehicles: [...byId.values()], encoding };
    } catch (error) {
      errors.push(`${encoding}: ${(error as Error).message}`);
    }
  }
  // Both encodings failing the same way is one problem, not two.
  const messages = [...new Set(errors.map((error) => error.replace(/^(typed|flat): /, '')))];
  throw new Error(messages.length === 1 ? messages[0] : errors.join('; '));
};
