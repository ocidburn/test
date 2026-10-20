/**
 * The city's own live vehicle table: `open-data.cui.wroclaw.pl/hdb/db/14`.
 *
 * Normalisation and merge rules ported from wroclaw-mpk-map (MIT,
 * © 2025 kijmoshi), commit b11fe19 — server/src/open-data.js. See NOTICE.
 *
 * Rows carry Polish column names, the side number (`Nr_Boczny`), the brigade
 * and `Data_Aktualizacji` — a wall clock with no zone marker.
 */
import { distanceMeters } from '../geo';
import { request, type FetchLike } from '../net/http';
import { warsawOffsetMinutes } from '../time/warsaw';
import { inArea, type LiveVehicle } from './types';

export const OPEN_DATA_URL = 'https://open-data.cui.wroclaw.pl/hdb/db/14?download=json';

const FIELD_ALIASES = {
  line: ['Nazwa_Linii', 'nazwa_linii', 'line', 'linia'],
  vehicleNumber: ['Nr_Boczny', 'nr_boczny', 'vehicle_number'],
  brigade: ['Brygada', 'brygada', 'brigade'],
  lat: ['Ostatnia_Pozycja_Szerokosc', 'szerokosc', 'lat'],
  lon: ['Ostatnia_Pozycja_Dlugosc', 'dlugosc', 'lon'],
  time: ['Data_Aktualizacji', 'data_aktualizacji', 'timestamp'],
};

const pick = (row: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

export const MAX_POSITION_AGE_MS = 120_000;
const MAX_FUTURE_SKEW_MS = 10_000;

type WallClock = { naive: number; zoned: number | null };

/**
 * A timestamp as written: its wall-clock reading (as if it were UTC) and,
 * when it states a zone or is an epoch number, the exact instant.
 * Accepts "2026-06-15 08:07:30[.123][Z|+02:00]", "2026-06-15T08:07:30",
 * "15.06.2026 08:07:30" and epoch seconds or milliseconds.
 */
const readWallClock = (value: unknown): WallClock | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e11 ? value * 1000 : value;
    return { naive: ms, zoned: ms };
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  let parts: string[] | null = null;
  let zone: string | undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(text);
  if (iso) {
    parts = [iso[1], iso[2], iso[3], iso[4], iso[5], iso[6] ?? '0', iso[7] ?? '0'];
    zone = iso[8];
  } else {
    const polish = /^(\d{2})\.(\d{2})\.(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
    if (polish) parts = [polish[3], polish[2], polish[1], polish[4], polish[5], polish[6] ?? '0', '0'];
  }
  if (!parts) return null;
  const [y, mo, d, h, mi, s, fraction] = parts;
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(`0.${fraction}`) * 1000);
  if (!zone) return { naive, zoned: null };
  if (zone === 'Z') return { naive, zoned: naive };
  const sign = zone.startsWith('-') ? -1 : 1;
  const digits = zone.replace(/[^0-9]/g, '');
  return { naive, zoned: naive - sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * 60_000 };
};

/** A wall clock read as Wrocław time; near a DST switch the offset is re-read at the corrected instant. */
const warsawInstant = (naive: number) => {
  const first = naive - warsawOffsetMinutes(naive) * 60_000;
  return naive - warsawOffsetMinutes(first) * 60_000;
};

export type Clock = 'warsaw' | 'utc';

const instantOf = (clock: WallClock, basis: Clock) => clock.zoned ?? (basis === 'utc' ? clock.naive : warsawInstant(clock.naive));

/** "2026-06-15 08:07:30" → epoch ms, a bare wall clock read as Wrocław time. */
export const parseWarsawWallClock = (value: unknown): number | null => {
  const clock = readWallClock(value);
  return clock ? instantOf(clock, 'warsaw') : null;
};

export type RejectReason = 'line' | 'number' | 'position' | 'time' | 'stale' | 'future';

type Extracted = Omit<LiveVehicle, 'positionAt'> & { clock: WallClock };

const extract = (row: unknown, isTram: (line: string) => boolean): Extracted | RejectReason => {
  if (!row || typeof row !== 'object') return 'line';
  const record = row as Record<string, unknown>;
  const line = String(pick(record, FIELD_ALIASES.line) ?? '').trim().toUpperCase();
  if (!line) return 'line';
  const number = Number.parseFloat(String(pick(record, FIELD_ALIASES.vehicleNumber)));
  if (!Number.isFinite(number) || number <= 0) return 'number';
  const vehicleNumber = String(Math.trunc(number));
  // A decimal comma is how a Polish export may write coordinates.
  const lat = Number.parseFloat(String(pick(record, FIELD_ALIASES.lat)).replace(',', '.'));
  const lon = Number.parseFloat(String(pick(record, FIELD_ALIASES.lon)).replace(',', '.'));
  if (!inArea(lat, lon)) return 'position';
  const clock = readWallClock(pick(record, FIELD_ALIASES.time));
  if (!clock) return 'time';
  const brigade = pick(record, FIELD_ALIASES.brigade);
  return {
    id: `open-data:${vehicleNumber}`,
    line,
    tram: isTram(line),
    lat,
    lon,
    heading: null,
    source: 'open-data',
    vehicleNumber,
    brigade: brigade === undefined ? null : String(brigade),
    headsign: null,
    tripId: null,
    delaySeconds: null,
    clock,
  };
};

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

export type OpenDataResult = {
  vehicles: LiveVehicle[];
  /** Rows in the payload. */
  total: number;
  rejected: Partial<Record<RejectReason, number>>;
  /** How bare timestamps were read. */
  clock: Clock;
  /** Median age of the timestamps under that reading, seconds. */
  medianAgeSeconds: number | null;
};

/**
 * Parse the whole table. `Data_Aktualizacji` is expected to be Wrocław
 * time, but if reading it as UTC puts the bulk of the fleet nearer "now",
 * that reading wins — otherwise a zone slip upstream would silently age
 * every row off the map. Every dropped row is counted by reason.
 */
export const parseOpenDataRows = (
  rows: unknown[],
  { now, isTram, maxAgeMs = MAX_POSITION_AGE_MS }: { now: number; isTram: (line: string) => boolean; maxAgeMs?: number },
): OpenDataResult => {
  const rejected: Partial<Record<RejectReason, number>> = {};
  const reject = (reason: RejectReason) => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };
  const candidates: Extracted[] = [];
  for (const row of rows) {
    const result = extract(row, isTram);
    if (typeof result === 'string') reject(result);
    else candidates.push(result);
  }

  const warsawMedian = median(candidates.map((c) => now - instantOf(c.clock, 'warsaw')));
  const utcMedian = median(candidates.map((c) => now - instantOf(c.clock, 'utc')));
  const clock: Clock =
    warsawMedian !== null && utcMedian !== null && Math.abs(utcMedian) < Math.abs(warsawMedian) ? 'utc' : 'warsaw';

  const vehicles: LiveVehicle[] = [];
  for (const { clock: wall, ...vehicle } of candidates) {
    const positionAt = instantOf(wall, clock);
    const age = now - positionAt;
    if (age > maxAgeMs) reject('stale');
    else if (age < -MAX_FUTURE_SKEW_MS) reject('future');
    else vehicles.push({ ...vehicle, positionAt });
  }
  const chosen = clock === 'utc' ? utcMedian : warsawMedian;
  return {
    vehicles,
    total: rows.length,
    rejected,
    clock,
    medianAgeSeconds: chosen === null ? null : Math.round(chosen / 1000),
  };
};

/** One row, read as Wrocław time. */
export const normalizeOpenDataRow = (
  row: unknown,
  { now, isTram, maxAgeMs = MAX_POSITION_AGE_MS }: { now: number; isTram: (line: string) => boolean; maxAgeMs?: number },
): LiveVehicle | null => {
  const result = extract(row, isTram);
  if (typeof result === 'string') return null;
  const { clock, ...vehicle } = result;
  const positionAt = instantOf(clock, 'warsaw');
  const age = now - positionAt;
  if (age > maxAgeMs || age < -MAX_FUTURE_SKEW_MS) return null;
  return { ...vehicle, positionAt };
};

export const fetchOpenData = async ({
  fetchImpl,
  now = Date.now(),
  isTram,
  timeoutMs = 10_000,
}: {
  fetchImpl?: FetchLike;
  now?: number;
  isTram: (line: string) => boolean;
  timeoutMs?: number;
}): Promise<OpenDataResult> => {
  const payload = await request(OPEN_DATA_URL, (response) => response.json() as Promise<unknown>, {
    timeoutMs,
    fetchImpl,
    headers: { Accept: 'application/json' },
  });
  const rows = Array.isArray(payload) ? payload : (payload as { dane?: unknown } | null)?.dane;
  if (!Array.isArray(rows)) {
    const keys = payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 6).join(', ') : typeof payload;
    throw new Error(`no "dane" list in the response (keys: ${keys})`);
  }
  return parseOpenDataRows(rows, { now, isTram });
};

export type MergeOptions = { matchMaxMeters: number; dedupeMeters: number; ambiguityMeters: number };

export const DEFAULT_MERGE: MergeOptions = { matchMaxMeters: 250, dedupeMeters: 350, ambiguityMeters: 75 };

/**
 * Combine MPK (primary) with Open Data (supplementary).
 *
 * 1. A matched vehicle keeps MPK's id and position and gains the side
 *    number and brigade.
 * 2. A record matches the nearest MPK vehicle of the same line and kind
 *    within `matchMaxMeters` — unless a second candidate is nearly as close,
 *    in which case guessing would put the wrong number on the wrong tram.
 * 3. An unmatched record is shown on its own, unless any MPK vehicle of the
 *    same line is within `dedupeMeters`: then it is that vehicle twice.
 */
export const mergeWithOpenData = (
  mpk: LiveVehicle[],
  openData: LiveVehicle[],
  { matchMaxMeters, dedupeMeters, ambiguityMeters }: MergeOptions = DEFAULT_MERGE,
): LiveVehicle[] => {
  const fleet = new Map<string, LiveVehicle>(mpk.map((vehicle) => [vehicle.id, { ...vehicle }]));
  const byLine = new Map<string, LiveVehicle[]>();
  for (const vehicle of mpk) {
    const list = byLine.get(vehicle.line);
    if (list) list.push(vehicle);
    else byLine.set(vehicle.line, [vehicle]);
  }
  const used = new Set<string>();

  for (const record of openData) {
    let nearest: { vehicle: LiveVehicle; meters: number } | null = null;
    let second: { vehicle: LiveVehicle; meters: number } | null = null;
    let withinDedupe = false;
    for (const vehicle of byLine.get(record.line) ?? []) {
      const meters = distanceMeters(vehicle.lat, vehicle.lon, record.lat, record.lon);
      if (meters <= dedupeMeters) withinDedupe = true;
      if (vehicle.tram !== record.tram) continue;
      if (!nearest || meters < nearest.meters) {
        second = nearest;
        nearest = { vehicle, meters };
      } else if (!second || meters < second.meters) {
        second = { vehicle, meters };
      }
    }

    if (nearest && nearest.meters <= matchMaxMeters && !used.has(nearest.vehicle.id)) {
      const ambiguous = second && second.meters <= matchMaxMeters && second.meters - nearest.meters < ambiguityMeters;
      if (!ambiguous) {
        used.add(nearest.vehicle.id);
        const entry = fleet.get(nearest.vehicle.id)!;
        entry.source = 'merged';
        entry.vehicleNumber = record.vehicleNumber;
        entry.brigade = record.brigade;
        continue;
      }
    }
    if (withinDedupe) continue;
    fleet.set(record.id, record);
  }
  return [...fleet.values()];
};
