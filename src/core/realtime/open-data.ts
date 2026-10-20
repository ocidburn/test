/**
 * The city's own live vehicle table: `open-data.cui.wroclaw.pl/hdb/db/14`.
 *
 * Normalisation and merge rules ported from wroclaw-mpk-map (MIT,
 * © 2025 kijmoshi), commit b11fe19 — server/src/open-data.js. See NOTICE.
 *
 * Rows carry Polish column names, the side number (`Nr_Boczny`), the brigade
 * and `Data_Aktualizacji` — a Wrocław wall clock with no zone marker.
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

export const MAX_POSITION_AGE_MS = 90_000;
const MAX_FUTURE_SKEW_MS = 10_000;

/**
 * "2026-06-15 08:07:30" (optionally with fractions, a T, or an explicit
 * zone) → epoch ms. A bare wall clock is read as Wrocław time.
 */
export const parseWarsawWallClock = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s = '0', fraction = '0', zone] = match;
  const millis = Number(`0.${fraction}`) * 1000;
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), millis);
  if (zone) {
    if (zone === 'Z') return naive;
    const sign = zone.startsWith('-') ? -1 : 1;
    const digits = zone.replace(/[^0-9]/g, '');
    return naive - sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * 60_000;
  }
  // The offset at the naive instant is right except within an hour of a switch,
  // where re-reading it at the corrected instant settles it.
  const first = naive - warsawOffsetMinutes(naive) * 60_000;
  return naive - warsawOffsetMinutes(first) * 60_000;
};

export const normalizeOpenDataRow = (
  row: unknown,
  { now, isTram, maxAgeMs = MAX_POSITION_AGE_MS }: { now: number; isTram: (line: string) => boolean; maxAgeMs?: number },
): LiveVehicle | null => {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const line = String(pick(record, FIELD_ALIASES.line) ?? '').trim().toUpperCase();
  if (!line) return null;
  const number = Number.parseFloat(String(pick(record, FIELD_ALIASES.vehicleNumber)));
  if (!Number.isFinite(number) || number <= 0) return null;
  const vehicleNumber = String(Math.trunc(number));
  const lat = Number.parseFloat(String(pick(record, FIELD_ALIASES.lat)));
  const lon = Number.parseFloat(String(pick(record, FIELD_ALIASES.lon)));
  if (!inArea(lat, lon)) return null;
  const positionAt = parseWarsawWallClock(pick(record, FIELD_ALIASES.time));
  if (positionAt === null) return null;
  const age = now - positionAt;
  if (age > maxAgeMs || age < -MAX_FUTURE_SKEW_MS) return null;
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
    positionAt,
  };
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
}): Promise<LiveVehicle[]> => {
  const payload = await request(OPEN_DATA_URL, (response) => response.json() as Promise<{ dane?: unknown }>, {
    timeoutMs,
    fetchImpl,
    headers: { Accept: 'application/json' },
  });
  const rows = payload?.dane;
  if (!Array.isArray(rows)) throw new Error('response did not contain a "dane" list');
  const vehicles: LiveVehicle[] = [];
  for (const row of rows) {
    const vehicle = normalizeOpenDataRow(row, { now, isTram });
    if (vehicle) vehicles.push(vehicle);
  }
  return vehicles;
};

export type MergeOptions = { matchMaxMeters: number; dedupeMeters: number; ambiguityMeters: number };

export const DEFAULT_MERGE: MergeOptions = { matchMaxMeters: 250, dedupeMeters: 350, ambiguityMeters: 75 };

/**
 * Combine MPK (primary) with Open Data (supplementary).
 *
 * 1. A matched vehicle keeps MPK's id and position and gains the side
 *    number, brigade and position time.
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
