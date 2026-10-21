import { BASEMAPS, basemapById, DEFAULT_BASEMAP, keyFor, tileTemplate, type Basemap } from '../src/core/map/basemaps';
import { createGoogleSession, googleTileUrl, sessionUsable } from '../src/core/map/google-tiles';

describe('base layers', () => {
  test('ids are unique and an unknown id falls back to the default', () => {
    expect(new Set(BASEMAPS.map((b) => b.id)).size).toBe(BASEMAPS.length);
    expect(basemapById('nope').id).toBe(DEFAULT_BASEMAP);
  });

  test('a keyed layer has no template until its key is set; the key is URL-encoded', () => {
    const keyed: Basemap = {
      id: 't',
      name: 'T',
      group: 'keyed',
      kind: 'xyz',
      url: 'https://tiles.example/{z}/{x}/{y}.png?apikey={key}',
      darkUrl: 'https://tiles.example/dark/{z}/{x}/{y}.png?apikey={key}',
      key: 'thunderforest',
      maxZoom: 19,
      attribution: 'x',
      cacheSeconds: 86_400,
    };
    expect(keyFor(keyed)).toBe('thunderforest');
    expect(tileTemplate(keyed, { dark: false, keys: {} })).toBeNull();
    expect(tileTemplate(keyed, { dark: false, keys: { thunderforest: ' a b ' } })).toBe('https://tiles.example/{z}/{x}/{y}.png?apikey=a%20b');
    expect(tileTemplate(keyed, { dark: true, keys: { thunderforest: 'k' } })).toBe('https://tiles.example/dark/{z}/{x}/{y}.png?apikey=k');
    expect(keyFor(basemapById('google-hybrid'))).toBe('google');
    expect(keyFor(basemapById('apple-hybrid'))).toBeNull();
  });

  test('every tile layer names its source and keeps {z}/{x}/{y} or a WMS box', () => {
    for (const b of BASEMAPS) {
      if (b.kind !== 'xyz' && b.kind !== 'wms') continue;
      expect(b.attribution.length).toBeGreaterThan(0);
      for (const url of [b.url, b.darkUrl].filter((u): u is string => !!u)) {
        if (b.kind === 'xyz') expect(url).toMatch(/\{z\}.*\{x\}.*\{y\}/);
        else expect(url).toMatch(/\{minX\},\{minY\},\{maxX\},\{maxY\}/);
        expect(url.includes('{key}')).toBe(!!b.key);
      }
    }
  });
});

describe('Google Map Tiles', () => {
  test('a session per map type; hybrid adds the road layer', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ session: 'S1', expiry: '1893456000', tileWidth: 256, imageFormat: 'png' }));
    });
    const session = await createGoogleSession('k&1', { mapType: 'satellite', hybrid: true }, { fetchImpl });
    expect(calls[0].url).toBe('https://tile.googleapis.com/v1/createSession?key=k%261');
    expect(calls[0].body).toMatchObject({ mapType: 'satellite', layerTypes: ['layerRoadmap'] });
    expect(session).toEqual({ session: 'S1', expiresAt: 1893456000_000, mapType: 'satellite', hybrid: true });
    expect(googleTileUrl(session, 'k&1')).toBe('https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=S1&key=k%261');
    expect(sessionUsable(session, 1893456000_000 - 2 * 86_400_000)).toBe(true);
    // Renewed a day before it runs out.
    expect(sessionUsable(session, 1893456000_000 - 3600_000)).toBe(false);
  });

  test('an answer without a session is an error', async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ error: { message: 'API key not valid' } })));
    await expect(createGoogleSession('k', { mapType: 'roadmap' }, { fetchImpl })).rejects.toThrow('no session');
  });

  test('a refused key says so', async () => {
    const fetchImpl = jest.fn(async () => new Response('{}', { status: 403 }));
    await expect(createGoogleSession('k', { mapType: 'roadmap' }, { fetchImpl })).rejects.toThrow('ключ не принят');
  });
});
