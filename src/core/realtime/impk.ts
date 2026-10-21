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
