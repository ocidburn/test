/**
 * Map base layers. Apple's own map types need nothing; the others are tile
 * servers drawn over (and replacing) Apple's map, some with the user's own
 * key, typed in on the Data screen and never built in.
 */

export type AppleMapType = 'mutedStandard' | 'standard' | 'satellite' | 'hybrid' | 'satelliteFlyover' | 'hybridFlyover';
export type KeyName = 'thunderforest' | 'carto' | 'stadia' | 'google';
export type BasemapGroup = 'apple' | 'open' | 'keyed' | 'aerial' | 'city' | 'google';

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
      /** Apple's map type underneath, when not the default (hybrid with labels, satellite without). */
      under?: AppleMapType;
      /** Tiles cover only part of the world (a city): Apple's map shows where they have none. */
      replace?: boolean;
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
  city: 'Вроцлав (SIP)',
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
  // GUGiK's HighResolution orthophoto (5–25 cm, the newest flights), free for any use since 2020 (capabilities:
  // "brak ograniczeń"; the Geoportal terms do not restrict harvesting the orthophoto, unlike the TOPO service).
  // Its WMTS has only EPSG:2180/4326 matrix sets, but its WMS reprojects a GetMap in EPSG:3857 although the
  // capabilities do not list it: checked against Wrocław's 2024 orthophoto, the same image to the pixel.
  // Rendered per request, 0.6–7 s a tile. The faster StandardResolution WMTS was dropped: an older, blurrier
  // mosaic; in Wrocław the city's cached 2024 tiles below are this same image.
  {
    id: 'gugik-orto-hd',
    name: 'Ортофото Польши HD (GUGiK)',
    group: 'aerial',
    kind: 'wms',
    url:
      'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/HighResolution?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap' +
      '&LAYERS=Raster&STYLES=&SRS=EPSG:3857&BBOX={minX},{minY},{maxX},{maxY}&WIDTH={width}&HEIGHT={height}&FORMAT=image/jpeg',
    maxZoom: 21,
    attribution: 'Ortofotomapa: GUGiK, geoportal.gov.pl',
    cacheSeconds: 30 * 86_400,
    labels: true,
    offline: true,
  },
  // Wrocław's SIP portal (ArcGIS Enterprise): cached tiles in Web Mercator, the standard scheme, so
  // {z}/{y}/{x} directly; levels to 21; 404 outside the city, where Apple's map shows through.
  // Orthophoto 2024 (GUGiK's, 5 cm, the same image as the HD layer here, but cached: fast), street names
  // drawn in; geoportal.wroclaw.pl/zasoby: "brak ograniczeń".
  {
    id: 'wroclaw-orto-2024',
    name: 'Ортофото 2024 с улицами',
    group: 'city',
    kind: 'xyz',
    url: 'https://gis.um.wroc.pl/portal_srv/rest/services/Ortofotomapa_2024/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 21,
    attribution: 'Ortofotomapa 2024 (GUGiK); źródło: System Informacji Przestrzennej Wrocławia, www.geoportal.wroclaw.pl',
    cacheSeconds: 30 * 86_400,
    // Apple's satellite underneath flashed on every zoom while the new tiles loaded; replaced instead, the
    // map shows its neutral grid meanwhile (and nothing beyond the city, where the portal has no tiles).
    replace: true,
    offline: true,
  },
  // TEST, to be removed in the next build: the 2025 flight (LifeCoolCity, 19–22 Mar 2025, 5 cm). Its terms
  // allow viewing it through the city's WMTS service and in SIP's own apps only: no offline download.
  {
    id: 'wroclaw-orto-2025-test',
    name: 'Ортофото 2025 (тест)',
    group: 'city',
    kind: 'xyz',
    url: 'https://gis.um.wroc.pl/portal_srv/rest/services/Ortofotomapa_2025/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 21,
    attribution: 'Ortofotomapa 2025 (LifeCoolCity); źródło: System Informacji Przestrzennej Wrocławia, www.geoportal.wroclaw.pl',
    cacheSeconds: 7 * 86_400,
    replace: true,
  },
  // The city's base map ("Podkładowa mapa Wrocławia" / Mapa podstawowa: addresses, streets, railways,
  // buildings, greenery, water, land cover), drawn grey or in colour; geoportal.wroclaw.pl/zasoby lists its
  // terms as "brak ograniczeń" (no restrictions), so offline download is allowed. The city asks for its
  // source to be named as below.
  {
    id: 'wroclaw-grey',
    name: 'Серая карта города',
    group: 'city',
    kind: 'xyz',
    url: 'https://gis.um.wroc.pl/portal_srv/rest/services/podklad_szary_odniesienie/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 21,
    attribution: 'Źródło: System Informacji Przestrzennej Wrocławia, www.geoportal.wroclaw.pl',
    cacheSeconds: 30 * 86_400,
    under: 'mutedStandard',
    replace: false,
    offline: true,
  },
  {
    id: 'wroclaw-colour',
    name: 'Цветная карта города',
    group: 'city',
    kind: 'xyz',
    url: 'https://gis.um.wroc.pl/portal_srv/rest/services/podklad_mocny_odniesienie/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 21,
    attribution: 'Źródło: System Informacji Przestrzennej Wrocławia, www.geoportal.wroclaw.pl',
    cacheSeconds: 30 * 86_400,
    under: 'mutedStandard',
    replace: false,
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
