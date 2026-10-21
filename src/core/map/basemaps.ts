/**
 * Map base layers. Apple's own map types need nothing; the others are tile
 * servers drawn over (and replacing) Apple's map, some with the user's own
 * key, typed in on the Data screen and never built in.
 */

export type AppleMapType = 'mutedStandard' | 'standard' | 'satellite' | 'hybrid' | 'satelliteFlyover' | 'hybridFlyover';
export type KeyName = 'thunderforest' | 'stadia' | 'google';
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
    })
  | (Common & { kind: 'google'; mapType: 'roadmap' | 'satellite' | 'terrain'; hybrid: boolean });

export const KEY_NAMES: Record<KeyName, string> = {
  thunderforest: 'Thunderforest',
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

export const BASEMAPS: Basemap[] = [
  { id: 'apple-muted', name: 'Приглушённая', group: 'apple', kind: 'apple', mapType: 'mutedStandard' },
  { id: 'apple-standard', name: 'Стандарт', group: 'apple', kind: 'apple', mapType: 'standard' },
  { id: 'apple-satellite', name: 'Спутник', group: 'apple', kind: 'apple', mapType: 'satellite' },
  { id: 'apple-hybrid', name: 'Гибрид', group: 'apple', kind: 'apple', mapType: 'hybrid' },
  { id: 'apple-satellite-3d', name: 'Спутник 3D', group: 'apple', kind: 'apple', mapType: 'satelliteFlyover' },
  { id: 'apple-hybrid-3d', name: 'Гибрид 3D', group: 'apple', kind: 'apple', mapType: 'hybridFlyover' },
  { id: 'google-roadmap', name: 'Карта', group: 'google', kind: 'google', mapType: 'roadmap', hybrid: false },
  { id: 'google-satellite', name: 'Спутник', group: 'google', kind: 'google', mapType: 'satellite', hybrid: false },
  { id: 'google-hybrid', name: 'Гибрид', group: 'google', kind: 'google', mapType: 'satellite', hybrid: true },
  { id: 'google-terrain', name: 'Рельеф', group: 'google', kind: 'google', mapType: 'terrain', hybrid: false },
];

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
