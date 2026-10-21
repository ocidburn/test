import { HttpError, request, type RequestOptions } from './http';
import { md5 } from './md5';

/**
 * HTTP Digest authentication (RFC 7616, MD5 with or without qop=auth).
 *
 * fetch() does not answer Digest challenges itself, so a session asks once
 * without credentials, reads the 401's challenge and repeats the request
 * with an Authorization header. The challenge is kept, so later requests
 * go out signed straight away; a 401 on a signed request (a stale nonce)
 * is answered once with the new challenge.
 */

export type Credentials = { username: string; password: string };

export type Challenge = {
  realm: string;
  nonce: string;
  opaque: string | null;
  algorithm: 'MD5' | 'MD5-sess';
  /** True when the server offers qop=auth. */
  qopAuth: boolean;
};

/** Parse `WWW-Authenticate: Digest realm="…", nonce="…", …`. Null when it is not a usable Digest challenge. */
export const parseChallenge = (header: string | null): Challenge | null => {
  if (!header) return null;
  const match = /Digest\s+(.*)$/is.exec(header);
  if (!match) return null;
  const params = new Map<string, string>();
  const pattern = /([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^,\s]*))/gi;
  for (let part = pattern.exec(match[1]); part; part = pattern.exec(match[1])) {
    params.set(part[1].toLowerCase(), part[2] !== undefined ? part[2].replace(/\\(.)/g, '$1') : part[3]);
  }
  const realm = params.get('realm');
  const nonce = params.get('nonce');
  if (realm === undefined || !nonce) return null;
  const algorithm = (params.get('algorithm') ?? 'MD5').toUpperCase();
  if (algorithm !== 'MD5' && algorithm !== 'MD5-SESS') return null;
  const qop = params.get('qop');
  const qopAuth = qop !== undefined && qop.split(',').some((q) => q.trim().toLowerCase() === 'auth');
  // A qop the client cannot do (only auth-int): no way to answer.
  if (qop !== undefined && !qopAuth) return null;
  return { realm, nonce, opaque: params.get('opaque') ?? null, algorithm: algorithm === 'MD5' ? 'MD5' : 'MD5-sess', qopAuth };
};

/** The request-target that goes into the digest: path and query, without the origin. */
export const requestTarget = (url: string) => {
  const match = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([^#]*)/i.exec(url);
  const target = match?.[1] ?? '';
  return target === '' ? '/' : target.startsWith('?') ? `/${target}` : target;
};

const quote = (value: string) => `"${value.replace(/(["\\])/g, '\\$1')}"`;

export const authorizationHeader = (
  challenge: Challenge,
  credentials: Credentials,
  { method, uri, nc, cnonce }: { method: string; uri: string; nc: number; cnonce: string },
): string => {
  let ha1 = md5(`${credentials.username}:${challenge.realm}:${credentials.password}`);
  if (challenge.algorithm === 'MD5-sess') ha1 = md5(`${ha1}:${challenge.nonce}:${cnonce}`);
  const ha2 = md5(`${method}:${uri}`);
  const count = nc.toString(16).padStart(8, '0');
  const response = challenge.qopAuth
    ? md5(`${ha1}:${challenge.nonce}:${count}:${cnonce}:auth:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);
  const parts = [
    `username=${quote(credentials.username)}`,
    `realm=${quote(challenge.realm)}`,
    `nonce=${quote(challenge.nonce)}`,
    `uri=${quote(uri)}`,
    `algorithm=${challenge.algorithm}`,
    `response=${quote(response)}`,
  ];
  if (challenge.qopAuth) parts.push('qop=auth', `nc=${count}`, `cnonce=${quote(cnonce)}`);
  if (challenge.opaque !== null) parts.push(`opaque=${quote(challenge.opaque)}`);
  return `Digest ${parts.join(', ')}`;
};

const randomCnonce = () => {
  let value = '';
  for (let i = 0; i < 16; i += 1) value += Math.floor(Math.random() * 16).toString(16);
  return value;
};

export class DigestSession {
  private challenge: Challenge | null = null;
  private nc = 0;

  constructor(
    private readonly credentials: Credentials,
    private readonly cnonce: () => string = randomCnonce,
  ) {}

  async fetchText(url: string, options: RequestOptions = {}): Promise<string> {
    const method = (options.method ?? 'GET').toUpperCase();
    const send = () => {
      const headers = { ...(options.headers as Record<string, string> | undefined) };
      if (this.challenge) {
        this.nc += 1;
        headers.Authorization = authorizationHeader(this.challenge, this.credentials, {
          method,
          uri: requestTarget(url),
          nc: this.nc,
          cnonce: this.cnonce(),
        });
      }
      return request(url, (response) => response.text(), { ...options, method, headers });
    };
    try {
      return await send();
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 401) throw error;
      const signed = this.challenge !== null;
      const next = parseChallenge(error.headers?.get('www-authenticate') ?? null);
      if (!next) throw new Error(signed ? 'login or password rejected (HTTP 401)' : 'HTTP 401 without a Digest challenge');
      // Signed and refused with the same nonce: the credentials are wrong, not the nonce.
      if (signed && next.nonce === this.challenge!.nonce) {
        throw new Error('login or password rejected (HTTP 401)');
      }
      this.challenge = next;
      this.nc = 0;
      try {
        return await send();
      } catch (retry) {
        if (retry instanceof HttpError && retry.status === 401) throw new Error('login or password rejected (HTTP 401)');
        throw retry;
      }
    }
  }
}
