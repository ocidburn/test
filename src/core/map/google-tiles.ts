import { fetchJson, HttpError, type FetchLike } from '../net/http';

/**
 * Google Map Tiles API (2D tiles), with the user's own key. A tile URL needs
 * a session token, made once per map type and kept until it expires.
 */

export type GoogleMapType = 'roadmap' | 'satellite' | 'terrain';

export type GoogleSession = { session: string; expiresAt: number; mapType: GoogleMapType; hybrid: boolean };

const API = 'https://tile.googleapis.com';

/** A session is renewed this long before Google says it expires. */
const RENEW_MARGIN_MS = 24 * 3600_000;

export const createGoogleSession = async (
  key: string,
  { mapType, hybrid = false, language = 'pl-PL', region = 'PL' }: { mapType: GoogleMapType; hybrid?: boolean; language?: string; region?: string },
  { fetchImpl, now = Date.now() }: { fetchImpl?: FetchLike; now?: number } = {},
): Promise<GoogleSession> => {
  const body: Record<string, unknown> = { mapType, language, region, highDpi: true, scale: 'scaleFactor2x' };
  // Satellite with roads and labels on top: Google's hybrid.
  if (hybrid) body.layerTypes = ['layerRoadmap'];
  const answer = await fetchJson<{ session?: string; expiry?: string | number }>(`${API}/v1/createSession?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    fetchImpl,
  }).catch((error: unknown) => {
    // Google answers a bad key or a project without the API with 400/403.
    if (error instanceof HttpError && (error.status === 400 || error.status === 403)) {
      throw new Error(`ключ не принят или Map Tiles API не включён в проекте (HTTP ${error.status})`);
    }
    throw error;
  });
  if (!answer.session) throw new Error('Google: no session in the answer');
  const expiry = Number(answer.expiry);
  // `expiry` is in seconds since the epoch; without it, assume a day.
  const expiresAt = Number.isFinite(expiry) && expiry > 0 ? expiry * 1000 : now + 24 * 3600_000;
  return { session: answer.session, expiresAt, mapType, hybrid };
};

export const sessionUsable = (session: GoogleSession | null, now: number) => !!session && session.expiresAt - RENEW_MARGIN_MS > now;

export const googleTileUrl = (session: GoogleSession, key: string) =>
  `${API}/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session.session)}&key=${encodeURIComponent(key)}`;

/** Copyright for what is on screen, which Google requires to be shown with its tiles. */
export const fetchGoogleCopyright = async (
  session: GoogleSession,
  key: string,
  view: { zoom: number; north: number; south: number; east: number; west: number },
  fetchImpl?: FetchLike,
): Promise<string | null> => {
  const query = [
    `session=${encodeURIComponent(session.session)}`,
    `key=${encodeURIComponent(key)}`,
    `zoom=${Math.round(view.zoom)}`,
    `north=${view.north}`,
    `south=${view.south}`,
    `east=${view.east}`,
    `west=${view.west}`,
  ].join('&');
  const answer = await fetchJson<{ copyright?: string }>(`${API}/tile/v1/viewport?${query}`, { fetchImpl });
  return answer.copyright ?? null;
};
