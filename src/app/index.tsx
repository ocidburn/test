import * as Location from 'expo-location';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getStopsInBBox, getVariants, getVariantStops, type MapStop } from '../core/gtfs/map-queries';
import { inBBox, type BBox } from '../core/geo';
import { matchVariant, nextStop, stopsAlong, type Variant } from '../core/realtime/route-match';
import type { LiveVehicle } from '../core/realtime/types';
import { startLive, stopLive, useLive } from '../state/live';
import { useTimetable } from '../state/timetable';
import { StatusBanner } from '../ui/status-banner';
import { lineColor, useTheme } from '../ui/theme';
import { VehicleCard } from '../ui/vehicle-card';
import { useNow } from '../ui/use-now';
import { VehicleMarker } from '../ui/vehicle-marker';

const WROCLAW: Region = { latitude: 51.1079, longitude: 17.0385, latitudeDelta: 0.09, longitudeDelta: 0.09 };
/** Beyond this many markers in view (with no line filter) the map asks to zoom in. */
const MAX_MARKERS = 220;
/** Stops appear once zoomed in this far. */
const STOPS_DELTA = 0.022;

const regionBox = (region: Region, margin = 0.15): BBox => ({
  minLat: region.latitude - region.latitudeDelta * (0.5 + margin),
  maxLat: region.latitude + region.latitudeDelta * (0.5 + margin),
  minLon: region.longitude - region.longitudeDelta * (0.5 + margin),
  maxLon: region.longitude + region.longitudeDelta * (0.5 + margin),
});

type RouteView = {
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

  const [region, setRegion] = useState<Region>(WROCLAW);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteView | null>(null);
  const [stops, setStops] = useState<MapStop[]>([]);
  const [located, setLocated] = useState(false);
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
  const tooMany = filterSet.size === 0 && inView.length > MAX_MARKERS;
  const selected = vehicles.find((v) => v.id === selectedId) ?? null;
  const shown: LiveVehicle[] = tooMany ? (selected ? [selected] : []) : inView;

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
      if (route?.variant.shapeIdx === match.variant.shapeIdx) return;
      const routeStops = await getVariantStops(db, match.variant.shapeIdx);
      if (!cancelled) setRoute({ variant: match.variant, stops: stopsAlong(match.variant.points, routeStops) });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
    // `route` is read only to skip reloading the same variant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, selectedLine, selectedLat, selectedLon, selectedHeading]);

  const along = useMemo(() => {
    if (!route || !selected) return null;
    return matchVariant([route.variant], selected)?.projection.along ?? null;
  }, [route, selected]);
  const upcoming = route && along !== null ? nextStop(route.stops, along) : null;
  // A vehicle that dropped out of the feed takes its route off the map with it.
  const shownRoute = selected ? route : null;

  const select = (vehicle: LiveVehicle | null) => {
    setSelectedId(vehicle?.id ?? null);
    if (!vehicle || vehicle.line !== selected?.line) setRoute(null);
  };

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

  const failing = status ? Object.entries(status).filter(([, s]) => s.at !== null && !s.ok).map(([name]) => name) : [];

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={WROCLAW}
        onRegionChangeComplete={setRegion}
        onPress={(event) => {
          // On iOS a marker tap also reaches the map; only a tap on the map itself deselects.
          if (event.nativeEvent.action === 'marker-press') return;
          select(null);
        }}
        showsUserLocation={located}
        showsPointsOfInterests={false}
        showsBuildings={false}
        pitchEnabled={false}
        rotateEnabled={false}
        mapType="mutedStandard"
        toolbarEnabled={false}
      >
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
        {shown.map((vehicle) => (
          <Marker
            key={vehicle.id}
            coordinate={{ latitude: vehicle.lat, longitude: vehicle.lon }}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={vehicle.id === selectedId ? 1000 : 10}
            onPress={(event) => {
              event.stopPropagation();
              select(vehicle);
            }}
          >
            <VehicleMarker line={vehicle.line} tram={vehicle.tram} heading={vehicle.heading} selected={vehicle.id === selectedId} />
          </Marker>
        ))}
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
        <StatusBanner />
        <View style={[styles.chip, { backgroundColor: theme.surface }]}>
          <View style={[styles.dot, { backgroundColor: !at ? theme.muted : failing.length === 3 ? theme.danger : failing.length ? theme.amber : '#16A34A' }]} />
          <Text style={{ color: theme.text, fontSize: 13 }}>
            {!at
              ? 'Подключаюсь…'
              : tooMany
                ? `${inView.length} машин — приблизьте карту или выберите линии`
                : `${shown.length} на карте${failing.length ? ` · нет данных: ${failing.map((n) => SOURCE_NAMES[n]).join(', ')}` : ''}`}
          </Text>
        </View>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]} pointerEvents="box-none">
        <Pressable onPress={locate} style={[styles.round, { backgroundColor: theme.surface }]} accessibilityLabel="Где я">
          <Text style={{ color: theme.accent, fontSize: 20 }}>➤</Text>
        </Pressable>
        {selected ? (
          <VehicleCard
            vehicle={selected}
            headsign={selected.headsign ?? route?.variant.headsign ?? null}
            nextStop={upcoming?.name ?? null}
            now={now}
            onClose={() => select(null)}
          />
        ) : null}
      </View>
    </View>
  );
}

const SOURCE_NAMES: Record<string, string> = { mpk: 'MPK', openData: 'Open Data', klosok: 'Kłosok' };

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
