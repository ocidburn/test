import type { DigestSession } from '../net/digest';
import type { FetchLike } from '../net/http';
import { parseWarsawWallClock } from './open-data';
import { inArea, type LiveVehicle, type SourceDetail } from './types';

/**
 * iMPK, MPK Wrocław's own API, used with MPK's permission and the user's own
 * login. Nothing about it is built in but the default address: the login and
 * password are typed in on the phone, and until then iMPK is never asked.
 * HTTP Digest over ordinary, fully verified HTTPS.
 */

export const IMPK_DEFAULT_URL = 'https://impk.mpk.wroc.pl:8088/';

export const impkUrl = (base: string, fn: string, params: Record<string, string> = {}) => {
  const query = [`function=${encodeURIComponent(fn)}`, ...Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)];
  return `${base.trim().replace(/\/+$/, '')}/mobile?${query.join('&')}`;
};

export type ImpkProbe = { contentType: string | null; bytes: number; shape: string; body: string };

const describeShape = (value: unknown): string => {
  if (Array.isArray(value)) return `JSON, список из ${value.length}`;
  if (value && typeof value === 'object') return `JSON, объект: ${Object.keys(value).slice(0, 8).join(', ')}`;
  return `JSON, ${typeof value}`;
};

/** `a=1&b=x y` → { a: '1', b: 'x y' }; a bare name gets an empty value. */
export const parseParams = (text: string): Record<string, string> => {
  const params: Record<string, string> = {};
  for (const part of text.split('&')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) params[trimmed] = '';
    else params[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return params;
};

/**
 * Call one operation and say what came back: content type, size, shape and
 * the body. The answers' formats are not documented anywhere; until they
 * are pinned down from real responses, this is what the Data screen shows.
 */
export const probeImpk = async (
  session: DigestSession,
  base: string,
  fn: string,
  params: Record<string, string> = {},
  fetchImpl?: FetchLike,
): Promise<ImpkProbe> => {
  const { body, contentType } = await session.fetch(
    impkUrl(base, fn, params),
    async (response) => ({ body: await response.text(), contentType: response.headers.get('content-type') }),
    { fetchImpl, timeoutMs: 20_000 },
  );
  let shape = 'не JSON';
  try {
    shape = describeShape(JSON.parse(body));
  } catch {
    // Shown as is.
  }
  return { contentType, bytes: body.length, shape, body };
};

/**
 * `getPositions` answers a JSON list: the server's wall-clock time first
 * ("2026-10-21 13:40:50", Wrocław time), then one object per vehicle. With
 * `shortcut=true` the keys are one letter; without it they are spelled out:
 *
 *   { v: 4102, c: 29086669, x: 17.091331, y: 51.11346, l: "715", t: "b",
 *     s: "24313", d: "24708", e: 289000 }
 *   { code: 4102, course: 29086671, x: 17.090508, y: 51.113888, line: "715",
 *     type: "BUS", symbol: "24317", direction: "24708", delay: 0 }
 *
 * Both read from real answers: side number, course (run) id, lon/lat, line,
 * tram/bus, the current post symbol, the direction (terminus post symbol)
 * and the delay in milliseconds — taken as positive = late.
 */
export type ImpkPositions = {
  vehicles: LiveVehicle[];
  /** Post symbol of each vehicle's destination, by vehicle id, for the headsign. */
  destinations: Map<string, string>;
  detail: SourceDetail;
};

type Raw = Record<string, unknown>;

/** The short key, or its spelled-out twin. */
const field = (raw: Raw, short: string, long: string) => (raw[short] !== undefined ? raw[short] : raw[long]);

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '');

export const parseImpkPositions = (
  body: string,
  { now, isTram }: { now: number; isTram: (line: string, hint: string | null) => boolean },
): ImpkPositions => {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(body.trim() ? `not JSON: ${body.slice(0, 60).replace(/\s+/g, ' ')}` : 'empty body');
  }
  if (!Array.isArray(data)) throw new Error('unexpected answer: not a list');
  const stamped = typeof data[0] === 'string';
  if (!stamped && data.length === 0) throw new Error('empty list');
  const serverAt = stamped ? parseWarsawWallClock(data[0]) : null;
  // Never in the future: a server clock ahead of the phone's is not a newer fix.
  const positionAt = serverAt === null ? now : Math.min(serverAt, now);

  const rejected: Record<string, number> = {};
  const reject = (reason: string) => (rejected[reason] = (rejected[reason] ?? 0) + 1);
  const vehicles: LiveVehicle[] = [];
  const destinations = new Map<string, string>();
  const records = stamped ? data.slice(1) : data;
  for (const item of records) {
    if (!item || typeof item !== 'object') {
      reject('shape');
      continue;
    }
    const raw = item as Raw;
    const line = str(field(raw, 'l', 'line')).toUpperCase();
    if (!line) {
      reject('line');
      continue;
    }
    const number = str(field(raw, 'v', 'code'));
    if (!number) {
      reject('number');
      continue;
    }
    const lat = Number(raw.y);
    const lon = Number(raw.x);
    if (!inArea(lat, lon)) {
      reject('position');
      continue;
    }
    const delayMs = field(raw, 'e', 'delay');
    const delay = typeof delayMs === 'number' && Number.isFinite(delayMs) ? Math.round(delayMs / 1000) : null;
    const id = `impk:${number}`;
    const destination = str(field(raw, 'd', 'direction'));
    const type = str(field(raw, 't', 'type')).toLowerCase();
    if (destination) destinations.set(id, destination);
    vehicles.push({
      id,
      line,
      tram: isTram(line, type === 't' || type === 'tram' ? 'tram' : type === 'b' || type === 'bus' ? 'bus' : null),
      lat,
      lon,
      heading: null,
      source: 'impk',
      vehicleNumber: number,
      brigade: null,
      headsign: null,
      tripId: null,
      delaySeconds: delay,
      positionAt,
    });
  }
  return {
    vehicles,
    destinations,
    detail: {
      total: records.length,
      rejected,
      medianAgeSeconds: serverAt === null ? null : Math.round((now - serverAt) / 1000),
    },
  };
};
