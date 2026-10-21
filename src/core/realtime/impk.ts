import type { DigestSession } from '../net/digest';
import type { FetchLike } from '../net/http';

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

export type ImpkProbe = { bytes: number; shape: string; sample: string };

const describeShape = (value: unknown): string => {
  if (Array.isArray(value)) return `JSON, список из ${value.length}`;
  if (value && typeof value === 'object') return `JSON, объект: ${Object.keys(value).slice(0, 8).join(', ')}`;
  return `JSON, ${typeof value}`;
};

/**
 * Ask for vehicle positions once and say what came back. Until the answer's
 * format is pinned down from a real response, this is what the Data screen
 * shows: size, shape and the start of the body.
 */
export const probeImpk = async (session: DigestSession, base: string, fetchImpl?: FetchLike): Promise<ImpkProbe> => {
  const body = await session.fetchText(impkUrl(base, 'getPositions'), { fetchImpl, timeoutMs: 20_000 });
  let shape = 'не JSON';
  try {
    shape = describeShape(JSON.parse(body));
  } catch {
    // Shown as is.
  }
  return { bytes: body.length, shape, sample: body.slice(0, 600) };
};
