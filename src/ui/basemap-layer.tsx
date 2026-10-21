import { Directory, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';
import { UrlTile, WMSTile, type MapType, type Region } from 'react-native-maps';

import { basemapById, canGoOffline, keyFor, KEY_NAMES, tileTemplate, type Basemap } from '../core/map/basemaps';
import { fetchGoogleCopyright, googleTileUrl, type GoogleSession } from '../core/map/google-tiles';
import { tileDirectory } from '../platform/offline-tiles';
import { googleSession, useBasemap } from '../state/basemap';
import { useOffline } from '../state/offline';

type Tile = { kind: 'xyz' | 'wms'; url: string; maxZoom: number; cacheSeconds: number; cacheDir: string | null; replace: boolean };

export type BasemapLayer = {
  basemap: Basemap;
  /** Apple's map type under (or instead of) the tiles. */
  mapType: MapType;
  tile: Tile | null;
  attribution: string | null;
  /** Why the chosen layer is not shown (missing key, Google refused…); Apple's map is shown instead. */
  problem: string | null;
};

/** Layers that may go offline keep their tiles with the offline package; the others in the purgeable cache. */
const cacheDir = (basemap: Basemap, id: string) => {
  try {
    return canGoOffline(basemap) ? tileDirectory(id).uri : new Directory(Paths.cache, 'tiles', id).uri;
  } catch {
    return null;
  }
};

/** What the map draws for the chosen base layer. */
export const useBasemapLayer = (region: Region): BasemapLayer => {
  const dark = useColorScheme() === 'dark';
  const selected = useBasemap((state) => state.selected);
  const keys = useBasemap((state) => state.keys);
  const loaded = useBasemap((state) => state.loaded);
  const load = useBasemap((state) => state.load);
  const basemap = basemapById(selected);
  const offlinePackage = useOffline((state) => state.packages[basemap.id]);
  const [google, setGoogle] = useState<{ id: string; session: GoogleSession | null; error: string | null } | null>(null);
  const [copyright, setCopyright] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const googleKey = keys.google;
  useEffect(() => {
    if (basemap.kind !== 'google' || !googleKey) return;
    let cancelled = false;
    googleSession(basemap.mapType, basemap.hybrid)
      .then((session) => !cancelled && setGoogle({ id: basemap.id, session, error: null }))
      .catch((error: Error) => !cancelled && setGoogle({ id: basemap.id, session: null, error: error.message }));
    return () => {
      cancelled = true;
    };
  }, [basemap, googleKey]);

  const session = basemap.kind === 'google' && google?.id === basemap.id ? google.session : null;
  // Google asks for the copyright of what is on screen to be shown with its tiles.
  useEffect(() => {
    if (!session || !googleKey) return;
    let cancelled = false;
    const zoom = Math.log2(360 / Math.max(region.longitudeDelta, 1e-6));
    fetchGoogleCopyright(session, googleKey, {
      zoom,
      north: region.latitude + region.latitudeDelta / 2,
      south: region.latitude - region.latitudeDelta / 2,
      east: region.longitude + region.longitudeDelta / 2,
      west: region.longitude - region.longitudeDelta / 2,
    })
      .then((text) => !cancelled && setCopyright(text))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session, googleKey, region]);

  if (basemap.kind === 'apple') return { basemap, mapType: basemap.mapType, tile: null, attribution: null, problem: null };

  const key = keyFor(basemap);
  if (key && !keys[key]) {
    return { basemap, mapType: 'mutedStandard', tile: null, attribution: null, problem: `нужен ключ ${KEY_NAMES[key]} в «Данных»` };
  }

  if (basemap.kind === 'google') {
    if (!session || !googleKey) {
      const problem = google?.id === basemap.id && google.error ? `Google: ${google.error}` : null;
      return { basemap, mapType: 'mutedStandard', tile: null, attribution: null, problem };
    }
    return {
      basemap,
      // Under the tiles, a map type without Apple's street names: Google draws its own.
      mapType: 'satellite',
      tile: { kind: 'xyz', url: googleTileUrl(session, googleKey), maxZoom: 22, cacheSeconds: GOOGLE_CACHE_SECONDS, cacheDir: null, replace: true },
      attribution: `Google${copyright ? ` · ${copyright}` : ''}`,
      problem: null,
    };
  }

  const url = tileTemplate(basemap, { dark, keys });
  if (!url) return { basemap, mapType: 'mutedStandard', tile: null, attribution: null, problem: null };
  return {
    basemap,
    // Apple's street names stay over photos (hybrid); maps draw their own (satellite has none).
    mapType: basemap.under ?? (basemap.labels ? 'hybrid' : 'satellite'),
    tile: {
      kind: basemap.kind,
      url,
      maxZoom: basemap.maxZoom,
      // With an offline package its tiles are used as they are and never asked for again (max age 0).
      cacheSeconds: offlinePackage && canGoOffline(basemap) ? 0 : basemap.cacheSeconds,
      cacheDir: cacheDir(basemap, basemap.id + (dark && basemap.darkUrl ? '-dark' : '')),
      replace: basemap.replace ?? true,
    },
    attribution: basemap.attribution,
    problem: null,
  };
};

/** Google's tiles are not stored on the phone beyond the system's own HTTP cache. */
const GOOGLE_CACHE_SECONDS = 0;

/**
 * The tile overlay for a layer; Apple's map stays underneath only where no tile has loaded.
 *
 * MapKit draws nothing (its grey grid, under a layer that replaces the map) where a tile of the new zoom
 * level is still on its way. A second overlay underneath, reading the same cache in offline mode, fills
 * that gap at once: react-native-maps then serves the nearest of up to four lower zoom levels it has on the
 * phone, cropped and scaled up. Blurry for the moment it shows, then the sharp tile covers it.
 */
export function BasemapTiles({ tile }: { tile: Tile | null }) {
  if (!tile) return null;
  const common = {
    shouldReplaceMapContent: tile.replace,
    maximumZ: 22,
    maximumNativeZ: tile.maxZoom,
    tileSize: 256,
  };
  const Overlay = tile.kind === 'wms' ? WMSTile : UrlTile;
  // A new template (dark mode, a renewed Google session) is a new overlay.
  if (!tile.cacheDir) return <Overlay key={tile.url} urlTemplate={tile.url} {...common} />;
  // A max age of 0 keeps cached tiles for good (offline packages).
  const cache = { tileCachePath: tile.cacheDir, tileCacheMaxAge: tile.cacheSeconds };
  return (
    <>
      {/* The same max age: without one, every read here would mark the tile fresh and it would never be renewed. */}
      <Overlay key={`under-${tile.url}`} urlTemplate={tile.url} {...common} {...cache} offlineMode />
      <Overlay key={tile.url} urlTemplate={tile.url} {...common} {...cache} />
    </>
  );
}

/** The source's credit, which every tile provider here requires on the map. */
export function BasemapAttribution({ layer, bottom }: { layer: BasemapLayer; bottom: number }) {
  const text = layer.problem ?? layer.attribution;
  if (!text) return null;
  return (
    <View style={[styles.attribution, { bottom }]} pointerEvents="none">
      <Text style={styles.attributionText} numberOfLines={2}>
        {layer.problem ? `⚠︎ ${layer.basemap.name}: ${text}` : `© ${text}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  attribution: {
    position: 'absolute',
    left: 8,
    right: 80,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.75)',
    alignSelf: 'flex-start',
  },
  attributionText: { fontSize: 10, color: '#1F2937' },
});
