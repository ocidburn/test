import * as Location from 'expo-location';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getStopsInBBox, getVariants, getVariantStops, type MapStop } from '../core/gtfs/map-queries';
import { inBBox, type BBox } from '../core/geo';
import { matchVariant, nextStop, stopsAlong, type Variant } from '../core/realtime/route-match';
import { delayStatus, type RunDescription } from '../core/realtime/trip-match';
import type { LiveVehicle } from '../core/realtime/types';
import { spreadPoints, type Offset } from '../core/spread';
import { buildActiveOn, describeVehicle } from '../platform/describe';
import { useFavorites } from '../state/favorites';
import { startLive, stopLive, useLive } from '../state/live';
import { useMapView } from '../state/map-view';
import { useTimetable } from '../state/timetable';
import { isThreeD } from '../core/map/basemaps';
import { BasemapAttribution, BasemapTiles, useBasemapLayer } from '../ui/basemap-layer';
import { StatusBanner } from '../ui/status-banner';
import { lineColor, useTheme } from '../ui/theme';
import { VehicleCard } from '../ui/vehicle-card';
import { useNow } from '../ui/use-now';
import { VehicleMarker } from '../ui/vehicle-marker';

const WROCLAW: Region = { latitude: 51.1079, longitude: 17.0385, latitudeDelta: 0.09, longitudeDelta: 0.09 };
/** Beyond this many drops in view (with no line filter) the map asks to zoom in. */
const MAX_MARKERS = 220;
/** Dots are light: zoomed out, the whole city's fleet (~550 with iMPK) is drawn. */
const MAX_DOTS = 900;
/** Stops appear once zoomed in this far. */
const STOPS_DELTA = 0.022;
/** Zoomed out further than this, vehicles are small dots. */
const DOTS_DELTA = 0.05;
/** Drop markers closer than this on screen (points) are spread apart. */
const SPREAD_POINTS = 34;
const NO_OFFSET: Offset = { dx: 0, dy: 0 };

const regionBox = (region: Region, margin = 0.15): BBox => ({
  minLat: region.latitude - region.latitudeDelta * (0.5 + margin),
  maxLat: region.latitude + region.latitudeDelta * (0.5 + margin),
  minLon: region.longitude - region.longitudeDelta * (0.5 + margin),
  maxLon: region.longitude + region.longitudeDelta * (0.5 + margin),
});

type RouteView = {
  line: string;
  variant: Variant;
  stops: (Awaited<ReturnType<typeof getVariantStops>>[number] & { along: number })[];
};

export default function MapScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const db = useTimetable((state) => state.db);
  const vehicles = useLive((state) => state.vehicles);
  const at = useLive((state) => state.at);
  const status = useLive((state) => state.status);
  const filter = useLive((state) => state.filter);
  const favorites = useFavorites((state) => state.stops);
  const showDelays = useLive((state) => state.showDelays);

  const [region, setRegion] = useState<Region>(WROCLAW);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteView | null>(null);
  const [run, setRun] = useState<{ id: string; run: RunDescription | null } | null>(null);
  const [stops, setStops] = useState<MapStop[]>([]);
  const [located, setLocated] = useState(false);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const basemap = useBasemapLayer(region);
  const setViewBox = useMapView((state) => state.setBox);
  useEffect(() => {
    setViewBox({
      west: region.longitude - region.longitudeDelta / 2,
      east: region.longitude + region.longitudeDelta / 2,
      south: region.latitude - region.latitudeDelta / 2,
      north: region.latitude + region.latitudeDelta / 2,
    });
  }, [region, setViewBox]);
  const threeD = isThreeD(basemap.basemap);
  useEffect(() => {
    mapRef.current?.animateCamera({ pitch: threeD ? 60 : 0 }, { duration: 600 });
  }, [threeD]);
  const [delays, setDelays] = useState<Map<string, number | null>>(() => new Map());
  const variantsCache = useRef(new Map<string, Variant[]>());
  const now = useNow(5_000);

  // Poll only while the map is on screen and the app is in the foreground.
  useFocusEffect(
    useCallback(() => {
      if (AppState.currentState === 'active') startLive();
      const subscription = AppState.addEventListener('change', (next) => (next === 'active' ? startLive() : stopLive()));
      return () => {
        subscription.remove();
        stopLive();
      };
    }, []),
  );

  // A new timetable means new shapes.
  useEffect(() => variantsCache.current.clear(), [db]);

  // Permission granted on an earlier launch: show the blue dot straight away.
  useEffect(() => {
    Location.getForegroundPermissionsAsync()
      .then((permission) => permission.granted && setLocated(true))
      .catch(() => {});
  }, []);

  const filterSet = useMemo(() => new Set(filter), [filter]);
  const box = useMemo(() => regionBox(region), [region]);
  const inView = useMemo(
    () => vehicles.filter((v) => (filterSet.size === 0 || filterSet.has(v.line)) && inBBox(box, v.lat, v.lon)),
    [vehicles, filterSet, box],
  );
  const dots = region.latitudeDelta > DOTS_DELTA;
  const tooMany = filterSet.size === 0 && inView.length > (dots ? MAX_DOTS : MAX_MARKERS);
  const selected = vehicles.find((v) => v.id === selectedId) ?? null;
  const shown: LiveVehicle[] = useMemo(
    () => (tooMany ? (selected ? [selected] : []) : inView),
    [tooMany, selected, inView],
  );

  // Drawn offsets that keep drop markers from piling up. Positions are
  // projected with the visible span, which is close enough at city scale.
  const offsets = useMemo(() => {
    if (dots || !mapSize.width || !mapSize.height) return new Map<string, Offset>();
    const left = region.longitude - region.longitudeDelta / 2;
    const top = region.latitude + region.latitudeDelta / 2;
    return spreadPoints(
      shown.map((v) => ({
        id: v.id,
        x: ((v.lon - left) / region.longitudeDelta) * mapSize.width,
        y: ((top - v.lat) / region.latitudeDelta) * mapSize.height,
      })),
      SPREAD_POINTS,
    );
  }, [dots, mapSize, region, shown]);

  // The delay layer: each shown vehicle's run, once per poll. Kłosok carries
  // its delay; MPK runs are inferred, and no ring is drawn when none is found.
  useEffect(() => {
    if (!showDelays || !db || !shown.length) return;
    let cancelled = false;
    (async () => {
      const now = Date.now();
      const activeOn = await buildActiveOn(db, now);
      const next = new Map<string, number | null>();
      for (const vehicle of shown) {
        if (cancelled) return;
        if (vehicle.delaySeconds !== null) {
          next.set(vehicle.id, vehicle.delaySeconds);
          continue;
        }
        const description = await describeVehicle(db, vehicle, now, activeOn);
        next.set(vehicle.id, description?.run?.delaySeconds ?? null);
      }
      if (!cancelled) setDelays(next);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showDelays, db, shown]);

  // Stops in view once zoomed in.
  useEffect(() => {
    if (!db || region.latitudeDelta > STOPS_DELTA) return;
    let cancelled = false;
    getStopsInBBox(db, regionBox(region, 0.05))
      .then((rows) => !cancelled && setStops(rows))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [db, region]);

  // Which variant (and so which direction) the selected vehicle is on; refreshed on every poll.
  const selectedLine = selected?.line ?? null;
  const selectedLat = selected?.lat;
  const selectedLon = selected?.lon;
  const selectedHeading = selected?.heading ?? null;
  const selectedPositionAt = selected?.positionAt ?? null;
  useEffect(() => {
    if (!db || !selectedLine || selectedLat === undefined || selectedLon === undefined) return;
    let cancelled = false;
    (async () => {
      let variants = variantsCache.current.get(selectedLine);
      if (!variants) {
        variants = await getVariants(db, selectedLine);
        variantsCache.current.set(selectedLine, variants);
      }
      const match = matchVariant(variants, { lat: selectedLat, lon: selectedLon, heading: selectedHeading });
      if (cancelled) return;
      if (!match) {
        setRoute(null);
        return;
      }
      if (route?.line === selectedLine && route.variant.shapeIdx === match.variant.shapeIdx) return;
      const routeStops = await getVariantStops(db, match.variant.shapeIdx);
      if (!cancelled) setRoute({ line: selectedLine, variant: match.variant, stops: stopsAlong(match.variant.points, routeStops) });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
    // `route` is read only to skip reloading the same variant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, selectedLine, selectedLat, selectedLon, selectedHeading]);

  // Which scheduled run the selected vehicle is on: the ETA to its next stop
  // and, for MPK, its delay. A delay from the feed (iMPK, Kłosok) wins in the card.
  const describeKey = selected ? `${selectedId}` : null;
  useEffect(() => {
    // A stale run from a previous selection is ignored by `selectedRun`'s id
    // check, so this just skips rather than clearing state synchronously.
    if (
      !db ||
      !describeKey ||
      selectedLine === null ||
      selectedLat === undefined ||
      selectedLon === undefined ||
      selectedPositionAt === null
    )
      return;
    let cancelled = false;
    (async () => {
      const activeOn = await buildActiveOn(db, Date.now());
      const description = await describeVehicle(
        db,
        { line: selectedLine, lat: selectedLat, lon: selectedLon, heading: selectedHeading, positionAt: selectedPositionAt },
        Date.now(),
        activeOn,
      );
      if (!cancelled) setRun({ id: describeKey, run: description?.run ?? null });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [db, describeKey, selectedLine, selectedLat, selectedLon, selectedHeading, selectedPositionAt]);

  // A vehicle that dropped out of the feed takes its route off the map with it,
  // and a route still loading for a newly tapped line is not shown under the wrong vehicle.
  const shownRoute = selected && route?.line === selected.line ? route : null;
  const selectedRun = selected && run?.id === String(selectedId) ? run.run : null;
  const along = useMemo(() => {
    if (!shownRoute || !selected) return null;
    return matchVariant([shownRoute.variant], selected)?.projection.along ?? null;
  }, [shownRoute, selected]);
  const upcoming = shownRoute && along !== null ? nextStop(shownRoute.stops, along) : null;


  const locate = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return;
    setLocated(true);
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    mapRef.current?.animateToRegion(
      { latitude: position.coords.latitude, longitude: position.coords.longitude, latitudeDelta: 0.012, longitudeDelta: 0.012 },
      400,
    );
  };

  // While iMPK answers, the map does not depend on MPK: a failing MPK is only on the Data screen.
  const impkUp = !!status?.impk.ok;
  const asked = status
    ? Object.entries(status).filter(([name, s]) => s.at !== null && !s.idle && !(impkUp && (name === 'mpk' || name === 'openData')))
    : [];
  const failing = asked.filter(([, s]) => !s.ok).map(([name]) => name);
  const allFailing = failing.length > 0 && failing.length === asked.length;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        onLayout={(event) => setMapSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
        initialRegion={WROCLAW}
        onRegionChangeComplete={setRegion}
        onPress={(event) => {
          // On iOS a marker tap also reaches the map; only a tap on the map itself deselects.
          if (event.nativeEvent.action === 'marker-press') return;
          setSelectedId(null);
        }}
        showsUserLocation={located}
        showsPointsOfInterests={false}
        showsBuildings={false}
        // Apple's 3D views need a tilted camera; elsewhere the map stays flat.
        pitchEnabled={threeD}
        rotateEnabled={false}
        mapType={basemap.mapType}
        toolbarEnabled={false}
      >
        <BasemapTiles tile={basemap.tile} />
        {shownRoute ? (
          <Polyline
            coordinates={shownRoute.variant.points.map((p) => ({ latitude: p.lat, longitude: p.lon }))}
            strokeColor={lineColor(selected?.line ?? '', selected?.tram ?? false)}
            strokeWidth={5}
          />
        ) : null}
        {shownRoute
          ? shownRoute.stops.map((stop) => (
              <Marker
                key={`r${stop.stopIdx}-${stop.seq}`}
                coordinate={{ latitude: stop.lat, longitude: stop.lon }}
                anchor={{ x: 0.5, y: 0.5 }}
                onPress={(event) => {
                  event.stopPropagation();
                  router.push({ pathname: '/stop/[name]', params: { name: stop.name } });
                }}
              >
                <View style={[styles.routeStop, { borderColor: lineColor(selected?.line ?? '', selected?.tram ?? false) }]} />
              </Marker>
            ))
          : null}
        {!shownRoute && region.latitudeDelta <= STOPS_DELTA
          ? stops.map((stop) => (
              <Marker
                key={`s${stop.stopIdx}`}
                coordinate={{ latitude: stop.lat, longitude: stop.lon }}
                anchor={{ x: 0.5, y: 0.5 }}
                onPress={(event) => {
                  event.stopPropagation();
                  router.push({ pathname: '/stop/[name]', params: { name: stop.name } });
                }}
              >
                <View style={styles.stop} />
              </Marker>
            ))
          : null}
        {shown.map((vehicle) => {
          const isSelected = vehicle.id === selectedId;
          const offset = offsets.get(vehicle.id) ?? NO_OFFSET;
          return (
            <VehicleMarker
              key={vehicle.id}
              id={vehicle.id}
              line={vehicle.line}
              tram={vehicle.tram}
              lat={vehicle.lat}
              lon={vehicle.lon}
              heading={vehicle.heading}
              selected={isSelected}
              // The selected vehicle keeps its number even when zoomed out.
              look={dots && !isSelected ? 'dot' : 'drop'}
              delay={showDelays ? delayStatus(delays.get(vehicle.id) ?? vehicle.delaySeconds) : null}
              offsetX={offset.dx}
              offsetY={offset.dy}
              onSelect={setSelectedId}
            />
          );
        })}
      </MapView>

      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.buttons} pointerEvents="box-none">
          {/* Plain Pressables: a Link with asChild dropped the pill backgrounds on iOS. */}
          <Pressable
            onPress={() => router.push('/search')}
            style={[styles.button, styles.searchButton, { backgroundColor: theme.surface }]}
          >
            <Text style={{ color: theme.muted, fontSize: 16 }}>Поиск остановки</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/lines')}
            style={[styles.button, { backgroundColor: filter.length ? theme.accent : theme.surface }]}
          >
            <Text style={{ color: filter.length ? '#FFFFFF' : theme.text, fontWeight: '600' }}>
              {filter.length ? `Линии · ${filter.length}` : 'Линии'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/settings')}
            style={[styles.button, { backgroundColor: theme.surface }]}
            accessibilityLabel="Данные"
          >
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>⋯</Text>
          </Pressable>
        </View>
        {favorites.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.favoritesBar}
            contentContainerStyle={styles.favorites}
            keyboardShouldPersistTaps="handled"
          >
            {favorites.map((stop) => (
              <Pressable
                key={stop}
                onPress={() => router.push({ pathname: '/stop/[name]', params: { name: stop } })}
                style={[styles.favorite, { backgroundColor: theme.surface }]}
              >
                <Text style={{ color: theme.text, fontWeight: '600' }} numberOfLines={1}>
                  ★ {stop}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <StatusBanner />
        <View style={[styles.chip, { backgroundColor: theme.surface }]}>
          <View style={[styles.dot, { backgroundColor: !at ? theme.muted : allFailing ? theme.danger : failing.length ? theme.amber : '#16A34A' }]} />
          <Text style={{ color: theme.text, fontSize: 13 }}>
            {!at
              ? 'Подключаюсь…'
              : tooMany
                ? `${inView.length} машин — приблизьте карту или выберите линии`
                : `${shown.length} на карте${failing.length ? ` · нет данных: ${failing.map((n) => SOURCE_NAMES[n]).join(', ')}` : ''}`}
          </Text>
        </View>
      </View>

      <BasemapAttribution layer={basemap} bottom={insets.bottom + 26} />
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]} pointerEvents="box-none">
        <Pressable onPress={locate} style={[styles.round, { backgroundColor: theme.surface }]} accessibilityLabel="Где я">
          <Text style={{ color: theme.accent, fontSize: 20 }}>➤</Text>
        </Pressable>
        {selected ? (
          <VehicleCard
            vehicle={selected}
            headsign={selected.headsign ?? selectedRun?.headsign ?? shownRoute?.variant.headsign ?? null}
            nextStop={selectedRun?.nextStop?.name ?? upcoming?.name ?? null}
            nextStopEtaSeconds={selectedRun?.nextStop?.etaSeconds ?? null}
            delaySeconds={selected.delaySeconds ?? selectedRun?.delaySeconds ?? null}
            now={now}
            onClose={() => setSelectedId(null)}
          />
        ) : null}
      </View>
    </View>
  );
}

const SOURCE_NAMES: Record<string, string> = { impk: 'iMPK', mpk: 'MPK', openData: 'Open Data', klosok: 'Kłosok' };

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { position: 'absolute', left: 0, right: 0, top: 0, gap: 8 },
  buttons: { flexDirection: 'row', gap: 8, paddingHorizontal: 12 },
  button: {
    height: 44,
    minWidth: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  searchButton: { flex: 1, alignItems: 'flex-start' },
  favoritesBar: { flexGrow: 0 },
  favorites: { paddingHorizontal: 12, paddingVertical: 4, gap: 8 },
  favorite: {
    height: 36,
    maxWidth: 220,
    paddingHorizontal: 14,
    borderRadius: 18,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  chip: {
    alignSelf: 'flex-start',
    marginHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    maxWidth: '92%',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  bottom: { position: 'absolute', left: 12, right: 12, bottom: 0, gap: 10 },
  round: {
    alignSelf: 'flex-end',
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  stop: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#5F6670' },
  routeStop: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFFFFF', borderWidth: 3 },
});
