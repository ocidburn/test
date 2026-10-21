import * as Location from 'expo-location';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getStopsInBBox, getVariants, getVariantStops, type MapStop } from '../core/gtfs/map-queries';
import { inBBox, type BBox } from '../core/geo';
import { lineVisibility } from '../core/line-groups';
import { matchVariant, stopsAlong, type Variant } from '../core/realtime/route-match';
import { delayMinutesLabel, delayStatus, type RunDescription } from '../core/realtime/trip-match';
import type { LiveVehicle } from '../core/realtime/types';
import { spreadPoints, type Offset } from '../core/spread';
import { buildActiveOn, describeVehicle } from '../platform/describe';
import { useFavorites } from '../state/favorites';
import { startLive, stopLive, useLive } from '../state/live';
import { useMapView } from '../state/map-view';
import { useTimetable } from '../state/timetable';
import { isThreeD } from '../core/map/basemaps';
import { currentNotices, useAlerts } from '../state/alerts';
import { AlertIcon, GearIcon, LayersIcon, LinesIcon } from '../ui/icons';
import { useOpenOnce } from '../ui/use-open-once';
import { BasemapAttribution, BasemapTiles, useBasemapLayer } from '../ui/basemap-layer';
import { StatusBanner } from '../ui/status-banner';
import { lineColor, useTheme } from '../ui/theme';
import { VehicleSheet } from '../ui/vehicle-card';
import { useNow } from '../ui/use-now';
import { mapHeading as mapHeadingValue, MOVE_MS, VehicleMarker } from '../ui/vehicle-marker';

const WROCLAW: Region = { latitude: 51.1079, longitude: 17.0385, latitudeDelta: 0.09, longitudeDelta: 0.09 };
/** Beyond this many drops in view the map asks to zoom in (or to choose fewer lines). */
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
  const hidden = useLive((state) => state.hidden);
  const lines = useLive((state) => state.lines);
  const favorites = useFavorites((state) => state.stops);
  const showDelays = useLive((state) => state.showDelays);
  const notices = useAlerts((state) => state.notices);
  const seen = useAlerts((state) => state.seen);
  const refreshAlerts = useAlerts((state) => state.refresh);
  const open = useOpenOnce();

  const [region, setRegion] = useState<Region>(WROCLAW);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteView | null>(null);
  const [run, setRun] = useState<{ id: string; run: RunDescription | null } | null>(null);
  const [stops, setStops] = useState<MapStop[]>([]);
  const [located, setLocated] = useState(false);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  /** Camera heading, degrees clockwise from north: the map can be turned with two fingers. */
  const [heading, setHeading] = useState(0);
  // Following is tied to the vehicle it was turned on for: a new selection, or none, ends it.
  const [followId, setFollowId] = useState<string | null>(null);
  const headingBusy = useRef(false);
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
      if (AppState.currentState === 'active') {
        startLive();
        void refreshAlerts();
      }
      const subscription = AppState.addEventListener('change', (next) => {
        if (next !== 'active') return stopLive();
        startLive();
        // Itself skips the network unless half an hour has passed.
        void refreshAlerts();
      });
      return () => {
        subscription.remove();
        stopLive();
      };
    }, [refreshAlerts]),
  );

  // Notices in force or coming that have not been looked at yet.
  const unseenNotices = useMemo(() => {
    const looked = new Set(seen);
    return currentNotices(notices, now).filter((n) => !looked.has(n.id)).length;
  }, [notices, seen, now]);

  // A new timetable means new shapes.
  useEffect(() => variantsCache.current.clear(), [db]);

  // Permission granted on an earlier launch: show the blue dot straight away.
  useEffect(() => {
    Location.getForegroundPermissionsAsync()
      .then((permission) => permission.granted && setLocated(true))
      .catch(() => {});
  }, []);

  const visibility = useMemo(() => lineVisibility(lines, hidden), [lines, hidden]);
  const box = useMemo(() => regionBox(region), [region]);
  const inView = useMemo(
    () => vehicles.filter((v) => visibility.isShown(v.line, v.tram) && inBBox(box, v.lat, v.lon)),
    [vehicles, visibility, box],
  );
  const dots = region.latitudeDelta > DOTS_DELTA;
  const tooMany = inView.length > (dots ? MAX_DOTS : MAX_MARKERS);
  const selected = vehicles.find((v) => v.id === selectedId) ?? null;
  const shown: LiveVehicle[] = useMemo(
    () => (tooMany ? (selected ? [selected] : []) : inView),
    [tooMany, selected, inView],
  );

  // Drawn offsets that keep drop markers from piling up. Positions are
  // projected with the visible span, which is close enough at city scale.
  const offsets = useMemo(() => {
    if (dots || !mapSize.width || !mapSize.height) return new Map<string, Offset>();
    // Screen positions north-up, then turned with the map, since the offsets are in screen points.
    const rad = (heading * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return spreadPoints(
      shown.map((v) => {
        const x = ((v.lon - region.longitude) / region.longitudeDelta) * mapSize.width;
        const y = ((region.latitude - v.lat) / region.latitudeDelta) * mapSize.height;
        return { id: v.id, x: x * cos + y * sin, y: -x * sin + y * cos };
      }),
      SPREAD_POINTS,
    );
  }, [dots, mapSize, region, shown, heading]);

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
        // Every stop to the end of the run, for the sheet's list.
        { limit: 200 },
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

  // Following: the camera glides to the vehicle with each new position, as the marker does.
  const following = followId !== null && followId === selectedId;
  const followLat = following ? selected?.lat : undefined;
  const followLon = following ? selected?.lon : undefined;
  useEffect(() => {
    if (followLat === undefined || followLon === undefined) return;
    mapRef.current?.animateCamera({ center: { latitude: followLat, longitude: followLon } }, { duration: MOVE_MS });
  }, [followLat, followLon]);

  /** Read the camera's heading while the map moves (one read at a time). */
  const readHeading = () => {
    if (headingBusy.current) return;
    headingBusy.current = true;
    mapRef.current
      ?.getCamera()
      .then((camera) => {
        const next = ((camera.heading % 360) + 360) % 360;
        mapHeadingValue.setValue(next);
        setHeading(next);
      })
      .catch(() => {})
      .finally(() => {
        headingBusy.current = false;
      });
  };
  const selectedRun = selected && run?.id === String(selectedId) ? run.run : null;
  const along = useMemo(() => {
    if (!shownRoute || !selected) return null;
    return matchVariant([shownRoute.variant], selected)?.projection.along ?? null;
  }, [shownRoute, selected]);
  // Where the vehicle is on its route, and the stops ahead by geometry (for when no run matches).
  const position = useMemo(() => {
    if (!shownRoute || along === null) return null;
    const atStop = shownRoute.stops.find((stop) => Math.abs(stop.along - along) <= 40);
    const passed = shownRoute.stops.filter((stop) => stop.along < along).at(-1);
    const ahead = shownRoute.stops.filter((stop) => stop.along > along + 15);
    return {
      where: atStop ? `на остановке ${atStop.name}` : passed ? `проехал ${passed.name}` : `едет к ${ahead[0]?.name ?? 'конечной'}`,
      ahead,
    };
  }, [shownRoute, along]);

  // The selected vehicle's sheet opens at half the screen; the map's middle moves up to the half left over.
  const window = useWindowDimensions();
  const sheetHalf = Math.round(window.height * 0.5);
  const sheetFull = window.height - insets.top - 12;
  const padBottom = selected ? sheetHalf : 0;

  // A vehicle tapped low on the map would end up under the sheet: the map brings it into the free half.
  const sheetTop = window.height - sheetHalf;
  useEffect(() => {
    if (!selectedId || selectedLat === undefined || selectedLon === undefined) return;
    const coordinate = { latitude: selectedLat, longitude: selectedLon };
    mapRef.current
      ?.pointForCoordinate(coordinate)
      .then((point) => {
        if (point.y > sheetTop - 40) mapRef.current?.animateCamera({ center: coordinate }, { duration: 350 });
      })
      .catch(() => {});
    // Once per selection, not with every new position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);


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
        onRegionChange={(next, details) => {
          readHeading();
          // Dragging the map away from the followed vehicle ends following; turning it does not.
          if (details?.isGesture && following && selected && mapSize.height) {
            // Its screen position (turned with the map) against the middle of the part the sheet leaves free.
            const rad = (heading * Math.PI) / 180;
            const x = ((selected.lon - next.longitude) / next.longitudeDelta) * mapSize.width;
            const y = ((next.latitude - selected.lat) / next.latitudeDelta) * mapSize.height;
            const dx = x * Math.cos(rad) + y * Math.sin(rad);
            const dy = -x * Math.sin(rad) + y * Math.cos(rad) + padBottom / 2;
            if (Math.hypot(dx, dy) > Math.min(mapSize.width, mapSize.height - padBottom) * 0.2) setFollowId(null);
          }
        }}
        onRegionChangeComplete={(next) => {
          setRegion(next);
          readHeading();
        }}
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
        rotateEnabled
        // Our own north button (below) stands in for Apple's compass, which would sit under the top buttons.
        showsCompass={false}
        mapType={basemap.mapType}
        mapPadding={{ top: 0, left: 0, right: 0, bottom: padBottom }}
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
                  open({ pathname: '/stop/[name]', params: { name: stop.name } });
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
                  open({ pathname: '/stop/[name]', params: { name: stop.name } });
                }}
              >
                <View style={styles.stop} />
              </Marker>
            ))
          : null}
        {shown.map((vehicle) => {
          const isSelected = vehicle.id === selectedId;
          const offset = offsets.get(vehicle.id) ?? NO_OFFSET;
          const delaySeconds = showDelays ? (delays.get(vehicle.id) ?? vehicle.delaySeconds) : null;
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
              delay={showDelays ? delayStatus(delaySeconds) : null}
              delayText={delaySeconds !== null ? delayMinutesLabel(delaySeconds) : null}
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
            onPress={() => open('/search')}
            style={[styles.button, styles.searchButton, { backgroundColor: theme.surface }]}
          >
            <Text style={{ color: theme.muted, fontSize: 16 }} numberOfLines={1}>
              Поиск остановки
            </Text>
          </Pressable>
          <Pressable
            onPress={() => open('/alerts')}
            style={[styles.button, styles.icon, { backgroundColor: theme.surface }]}
            accessibilityLabel={unseenNotices ? `Изменения в движении, новых: ${unseenNotices}` : 'Изменения в движении'}
          >
            <AlertIcon color={unseenNotices ? theme.amber : theme.text} />
            {unseenNotices ? <Badge count={unseenNotices} color={theme.danger} /> : null}
          </Pressable>
          <Pressable
            onPress={() => open('/layers')}
            style={[styles.button, styles.icon, { backgroundColor: theme.surface }]}
            accessibilityLabel="Слои карты"
          >
            <LayersIcon color={theme.text} />
          </Pressable>
          <Pressable
            onPress={() => open('/lines')}
            style={[styles.button, styles.icon, { backgroundColor: !visibility.all ? theme.accent : theme.surface }]}
            accessibilityLabel={!visibility.all ? `Линии, показано: ${visibility.shownLines.length}` : 'Линии'}
          >
            <LinesIcon color={!visibility.all ? '#FFFFFF' : theme.text} />
            {!visibility.all ? <Badge count={visibility.shownLines.length} color="#1F2937" /> : null}
          </Pressable>
          <Pressable
            onPress={() => open('/settings')}
            style={[styles.button, styles.icon, { backgroundColor: theme.surface }]}
            accessibilityLabel="Данные"
          >
            <GearIcon color={theme.text} />
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
                onPress={() => open({ pathname: '/stop/[name]', params: { name: stop } })}
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

      <BasemapAttribution layer={basemap} bottom={selected ? sheetHalf + 8 : insets.bottom + 26} />
      <View style={[styles.bottom, { paddingBottom: selected ? sheetHalf + 12 : insets.bottom + 12 }]} pointerEvents="box-none">
        {Math.min(heading, 360 - heading) > 1 ? (
          <Pressable
            onPress={() => mapRef.current?.animateCamera({ heading: 0 }, { duration: 400 })}
            style={[styles.round, { backgroundColor: theme.surface }]}
            accessibilityLabel="Север вверх"
          >
            {/* The needle points to north on the turned map. */}
            <View style={[styles.needle, { transform: [{ rotate: `${-heading}deg` }] }]}>
              <Text style={styles.needleNorth}>▲</Text>
              <Text style={[styles.needleLetter, { color: theme.text }]}>N</Text>
            </View>
          </Pressable>
        ) : null}
        <Pressable onPress={locate} style={[styles.round, { backgroundColor: theme.surface }]} accessibilityLabel="Где я">
          <Text style={{ color: theme.accent, fontSize: 20 }}>➤</Text>
        </Pressable>
      </View>
      {selected ? (
        <VehicleSheet
          vehicle={selected}
          headsign={selected.headsign ?? selectedRun?.headsign ?? shownRoute?.variant.headsign ?? null}
          where={position?.where ?? null}
          run={selectedRun}
          routeStops={position?.ahead ?? []}
          delaySeconds={selected.delaySeconds ?? selectedRun?.delaySeconds ?? null}
          now={now}
          following={following}
          half={sheetHalf}
          full={sheetFull}
          onToggleFollow={() => setFollowId(following ? null : selectedId)}
          onClose={() => setSelectedId(null)}
          onStop={(name) => open({ pathname: '/stop/[name]', params: { name } })}
        />
      ) : null}
    </View>
  );
}

/** A count in the corner of a round button. */
const Badge = ({ count, color }: { count: number; color: string }) => (
  <View style={[styles.badge, { backgroundColor: color }]} pointerEvents="none">
    <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
  </View>
);

const SOURCE_NAMES: Record<string, string> = { impk: 'iMPK', mpk: 'MPK', openData: 'Open Data', klosok: 'Kłosok' };

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { position: 'absolute', left: 0, right: 0, top: 0, gap: 8 },
  buttons: { flexDirection: 'row', gap: 6, paddingHorizontal: 12 },
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
  icon: { width: 44, paddingHorizontal: 0 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
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
  needle: { alignItems: 'center' },
  needleNorth: { color: '#DC2626', fontSize: 14, lineHeight: 14 },
  needleLetter: { fontSize: 11, fontWeight: '700', lineHeight: 12 },
  stop: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#5F6670' },
  routeStop: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFFFFF', borderWidth: 3 },
});
