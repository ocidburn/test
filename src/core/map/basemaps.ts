/**
 * Map base layers. Apple's own map types need nothing; the others are tile
 * servers drawn over (and replacing) Apple's map, some with the user's own
 * key, typed in on the Data screen and never built in.
 */

export type AppleMapType = 'mutedStandard' | 'standard' | 'satellite' | 'hybrid' | 'satelliteFlyover' | 'hybridFlyover';
export type KeyName = 'thunderforest' | 'carto' | 'stadia' | 'google';
export type BasemapGroup = 'apple' | 'open' | 'keyed' | 'aerial' | 'google';

type Common = { id: string; name: string; group: BasemapGroup };

export type Basemap =
  | (Common & { kind: 'apple'; mapType: AppleMapType })
  | (Common & {
      kind: 'xyz' | 'wms';
      /** {z}/{x}/{y} (xyz) or {minX}…{height} (wms, EPSG:3857); {key} is the user's key. */
      url: string;
      /** The style for the phone's dark mode, when the server has one. */
      darkUrl?: string;
      key?: KeyName;
      maxZoom: number;
      attribution: string;
      /** How long a tile may be kept on the phone before it is asked again. */
      cacheSeconds: number;
      /** Apple's street names over the tiles: for photos, which have none of their own. */
      labels?: boolean;
      /** Its terms allow downloading an area for offline use (open data); most providers forbid it. */
      offline?: boolean;
    })
  | (Common & { kind: 'google'; mapType: 'roadmap' | 'satellite' | 'terrain'; hybrid: boolean });

export const KEY_NAMES: Record<KeyName, string> = {
  thunderforest: 'Thunderforest',
  carto: 'CARTO',
  stadia: 'Stadia Maps',
  google: 'Google Map Tiles API',
};

export const GROUP_NAMES: Record<BasemapGroup, string> = {
  apple: 'Apple',
  open: 'Открытые',
  keyed: 'С ключом',
  aerial: 'Аэрофото',
  google: 'Google',
};

export const DEFAULT_BASEMAP = 'apple-muted';

const WEEK = 7 * 86_400;
const OSM = 'OpenStreetMap contributors';

export const BASEMAPS: Basemap[] = [
  { id: 'apple-muted', name: 'Приглушённая', group: 'apple', kind: 'apple', mapType: 'mutedStandard' },
  { id: 'apple-standard', name: 'Стандарт', group: 'apple', kind: 'apple', mapType: 'standard' },
  { id: 'apple-satellite', name: 'Спутник', group: 'apple', kind: 'apple', mapType: 'satellite' },
  { id: 'apple-hybrid', name: 'Гибрид', group: 'apple', kind: 'apple', mapType: 'hybrid' },
  { id: 'apple-satellite-3d', name: 'Спутник 3D', group: 'apple', kind: 'apple', mapType: 'satelliteFlyover' },
  { id: 'apple-hybrid-3d', name: 'Гибрид 3D', group: 'apple', kind: 'apple', mapType: 'hybridFlyover' },
  // OSM's own server: on demand only (no prefetch), tiles kept a week, as its policy asks.
  {
    id: 'osm',
    name: 'OpenStreetMap',
    group: 'open',
    kind: 'xyz',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution: OSM,
    cacheSeconds: WEEK,
  },
  // ÖPNVKarte: public transport lines on an OSM base; free, but a volunteer-run server.
  {
    id: 'opnv',
    name: 'ÖPNVKarte (транспорт)',
    group: 'open',
    kind: 'xyz',
    url: 'https://tileserver.memomaps.de/tilegen/{z}/{x}/{y}.png',
    maxZoom: 18,
    attribution: `Map memomaps.de CC-BY-SA, map data ${OSM}`,
    cacheSeconds: WEEK,
  },
  // Thunderforest Transport: Hobby tier, 150 000 tiles a month.
  {
    id: 'thunderforest-transport',
    name: 'Транспорт (Thunderforest)',
    group: 'keyed',
    kind: 'xyz',
    url: 'https://api.thunderforest.com/transport/{z}/{x}/{y}.png?apikey={key}',
    darkUrl: 'https://api.thunderforest.com/transport-dark/{z}/{x}/{y}.png?apikey={key}',
    key: 'thunderforest',
    maxZoom: 22,
    attribution: `Maps Thunderforest, Data ${OSM}`,
    cacheSeconds: WEEK,
  },
  // CARTO: a key is required since 25 Sep 2026; free non-commercial use up to 5M requests a month.
  {
    id: 'carto',
    name: 'Positron / Dark Matter (CARTO)',
    group: 'keyed',
    kind: 'xyz',
    url: 'https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key={key}',
    darkUrl: 'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key={key}',
    key: 'carto',
    maxZoom: 20,
    attribution: `${OSM}, CARTO`,
    cacheSeconds: WEEK,
  },
  // Stadia: free plan, 200 000 tiles a month, non-commercial.
  {
    id: 'stadia',
    name: 'Alidade Smooth (Stadia)',
    group: 'keyed',
    kind: 'xyz',
    url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png?api_key={key}',
    darkUrl: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png?api_key={key}',
    key: 'stadia',
    maxZoom: 20,
    attribution: `Stadia Maps, OpenMapTiles, ${OSM}`,
    cacheSeconds: WEEK,
  },
  // GUGiK's national orthophoto (25 cm), free since 2020; WMS in Web Mercator.
  {
    id: 'gugik-orto',
    name: 'Ортофото Польши (GUGiK)',
    group: 'aerial',
    kind: 'wms',
    url:
      'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap' +
      '&LAYERS=Raster&STYLES=&SRS=EPSG:3857&BBOX={minX},{minY},{maxX},{maxY}&WIDTH={width}&HEIGHT={height}&FORMAT=image/jpeg',
    maxZoom: 20,
    attribution: 'Ortofotomapa: GUGiK, geoportal.gov.pl',
    cacheSeconds: 30 * 86_400,
    labels: true,
    offline: true,
  },
  // The same orthophoto through GUGiK's WMTS: cached tiles, so faster than the WMS. Layer ORTOFOTOMAPA,
  // matrix set EPSG:3857 (added Aug 2021), matrices EPSG:3857:0…19, 256 px.
  {
    id: 'gugik-orto-wmts',
    name: 'Ортофото Польши, WMTS',
    group: 'aerial',
    kind: 'xyz',
    url:
      'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
      '&LAYER=ORTOFOTOMAPA&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}',
    maxZoom: 19,
    attribution: 'Ortofotomapa: GUGiK, geoportal.gov.pl',
    cacheSeconds: 30 * 86_400,
    labels: true,
    offline: true,
  },
  { id: 'google-roadmap', name: 'Карта', group: 'google', kind: 'google', mapType: 'roadmap', hybrid: false },
  { id: 'google-satellite', name: 'Спутник', group: 'google', kind: 'google', mapType: 'satellite', hybrid: false },
  { id: 'google-hybrid', name: 'Гибрид', group: 'google', kind: 'google', mapType: 'satellite', hybrid: true },
  { id: 'google-terrain', name: 'Рельеф', group: 'google', kind: 'google', mapType: 'terrain', hybrid: false },
];

/** Apple's 3D views: the camera tilts so buildings stand up. */
export const isThreeD = (basemap: Basemap) =>
  basemap.kind === 'apple' && (basemap.mapType === 'satelliteFlyover' || basemap.mapType === 'hybridFlyover');

export const canGoOffline = (basemap: Basemap) => (basemap.kind === 'xyz' || basemap.kind === 'wms') && !!basemap.offline;

export const basemapById = (id: string): Basemap => BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];

/** The key a base layer needs, if any. */
export const keyFor = (basemap: Basemap): KeyName | null =>
  basemap.kind === 'google' ? 'google' : basemap.kind === 'xyz' || basemap.kind === 'wms' ? (basemap.key ?? null) : null;

/** The tile URL template for an xyz/wms layer; null when its key is missing. */
export const tileTemplate = (basemap: Basemap, { dark, keys }: { dark: boolean; keys: Partial<Record<KeyName, string>> }): string | null => {
  if (basemap.kind !== 'xyz' && basemap.kind !== 'wms') return null;
  const url = dark && basemap.darkUrl ? basemap.darkUrl : basemap.url;
  if (!basemap.key) return url;
  const key = keys[basemap.key]?.trim();
  return key ? url.replace('{key}', encodeURIComponent(key)) : null;
};
