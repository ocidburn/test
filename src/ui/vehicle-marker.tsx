import { memo, useEffect, useRef, useState, type ComponentType } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { AnimatedRegion, MarkerAnimated, type LatLng, type MapMarkerProps } from 'react-native-maps';

import { distanceMeters } from '../core/geo';
import { markerKind, type MarkerKind } from '../core/lines';
import type { DelayStatus } from '../core/realtime/trip-match';
import { lineColor } from './theme';

const SIZE = 30;
const BOX = 58;
const DOT = 12;
const DOT_BOX = 30;
const TIP_HALF_WIDTH = 11;
const TIP_TOP = 2;
/** The tip's base sits inside the body, so the two read as one drop. */
const TIP_HEIGHT = BOX / 2 - SIZE / 2 - TIP_TOP + 7;
/** How long a marker takes to glide to its new position. Polls are 10 s apart. */
export const MOVE_MS = 3000;
/** Further than this between two polls is a GPS jump or a source switch: no glide. */
const TELEPORT_METERS = 1000;

export const DELAY_COLORS: Record<Exclude<DelayStatus, 'none'>, string> = {
  ok: '#16A34A',
  mid: '#F59E0B',
  late: '#DC2626',
};

// The animated marker's typings drop `children`; it renders them like a plain Marker.
const AnimatedMarker = MarkerAnimated as unknown as ComponentType<MapMarkerProps>;

/** The shortest turn from `from` (any real number of degrees) to the bearing `to`. */
const shortestTurn = (from: number, to: number) => from + ((((to - from) % 360) + 540) % 360) - 180;

export type MarkerStyle = 'drop' | 'dot';

/**
 * A vehicle on the map.
 *
 * `drop`: a line-coloured body whose shape tells the kind — rounded square for
 * a tram, circle for a bus, diamond for an express, dashed rim for a suburban
 * bus, a light rim on the dark night colour — and a tip that points where the
 * vehicle is heading (hidden while unknown). Only the tip turns, so the number
 * stays upright.
 *
 * `dot`: for a zoomed-out map, a small dot with a tail behind it.
 *
 * With the delay layer on, a ring (drop) or the rim (dot) shows how late the
 * run is. The marker glides to each new position; `offset` (screen points)
 * only moves where it is drawn, to keep it clear of its neighbours.
 */
export const VehicleMarker = memo(function VehicleMarker({
  id,
  line,
  tram,
  lat,
  lon,
  heading,
  selected,
  look,
  delay,
  offsetX,
  offsetY,
  onSelect,
}: {
  id: string;
  line: string;
  tram: boolean;
  lat: number;
  lon: number;
  heading: number | null;
  selected: boolean;
  look: MarkerStyle;
  delay: DelayStatus;
  offsetX: number;
  offsetY: number;
  onSelect: (id: string) => void;
}) {
  // Created once per marker; later positions arrive through timing animations.
  const [anim] = useState(() => ({
    region: new AnimatedRegion({ latitude: lat, longitude: lon, latitudeDelta: 0, longitudeDelta: 0 }),
    rotation: new Animated.Value(heading ?? 0),
  }));
  // Where the animations are heading; a ref, since it changes without a render.
  const target = useRef({ lat, lon, rotation: heading ?? 0 });

  useEffect(() => {
    const { region } = anim;
    const to = target.current;
    if (to.lat === lat && to.lon === lon) return;
    const jump = distanceMeters(to.lat, to.lon, lat, lon) > TELEPORT_METERS;
    to.lat = lat;
    to.lon = lon;
    region.stopAnimation(() => {});
    region
      .timing({
        latitude: lat,
        longitude: lon,
        latitudeDelta: 0,
        longitudeDelta: 0,
        // Required by the typings; AnimatedRegion sets each value's own target.
        toValue: 0,
        duration: jump ? 0 : MOVE_MS,
        easing: Easing.inOut(Easing.quad),
        // Marker coordinates are not a native-driver prop.
        useNativeDriver: false,
      })
      .start();
  }, [anim, lat, lon]);

  useEffect(() => {
    if (heading === null) return;
    const next = shortestTurn(target.current.rotation, heading);
    if (next === target.current.rotation) return;
    target.current.rotation = next;
    Animated.timing(anim.rotation, {
      toValue: next,
      duration: 600,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [anim, heading]);

  const color = lineColor(line, tram);
  const rotate = anim.rotation.interpolate({ inputRange: [-36_000, 36_000], outputRange: ['-36000deg', '36000deg'] });

  return (
    <AnimatedMarker
      // AnimatedRegion drives the coordinate; the typings only know plain LatLng.
      coordinate={anim.region as unknown as LatLng}
      anchor={{ x: 0.5, y: 0.5 }}
      centerOffset={{ x: offsetX, y: offsetY }}
      zIndex={selected ? 1000 : look === 'dot' ? 5 : 10}
      onPress={(event) => {
        event.stopPropagation();
        onSelect(id);
      }}
    >
      {look === 'dot' ? (
        <Dot color={color} delay={delay} selected={selected} rotate={heading !== null ? rotate : null} />
      ) : (
        <Drop
          line={line}
          kind={markerKind(line, tram)}
          color={color}
          delay={delay}
          selected={selected}
          rotate={heading !== null ? rotate : null}
        />
      )}
    </AnimatedMarker>
  );
});

type Rotation = Animated.AnimatedInterpolation<string> | null;

const Drop = ({
  line,
  kind,
  color,
  delay,
  selected,
  rotate,
}: {
  line: string;
  kind: MarkerKind;
  color: string;
  delay: DelayStatus;
  selected: boolean;
  rotate: Rotation;
}) => {
  const long = line.length > 2;
  const rim = selected ? '#FFD60A' : kind === 'night' ? '#C7CDD4' : '#FFFFFF';
  return (
    <View style={styles.box} pointerEvents="none">
      {delay !== 'none' ? <View style={[styles.ring, { borderColor: DELAY_COLORS[delay] }]} /> : null}
      {rotate ? (
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
          {/* A white tip under the coloured one outlines it on any map. */}
          <View style={[styles.tip, styles.tipOutline, { borderBottomColor: rim }]} />
        </Animated.View>
      ) : null}
      {kind === 'express' ? (
        <View style={[styles.diamond, { backgroundColor: color, borderColor: rim }, selected && styles.selected]} />
      ) : (
        <View
          style={[
            styles.body,
            long && styles.wide,
            kind === 'tram' && styles.square,
            kind === 'suburban' && styles.dashed,
            { backgroundColor: color, borderColor: rim },
            selected && styles.selected,
          ]}
        />
      )}
      {rotate ? (
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
          <View style={[styles.tip, { borderBottomColor: color }]} />
        </Animated.View>
      ) : null}
      <View style={styles.label}>
        <Text style={[styles.text, long && styles.smallText]} numberOfLines={1}>
          {line}
        </Text>
      </View>
    </View>
  );
};

const Dot = ({
  color,
  delay,
  selected,
  rotate,
}: {
  color: string;
  delay: DelayStatus;
  selected: boolean;
  rotate: Rotation;
}) => (
  <View style={styles.dotBox} pointerEvents="none">
    {rotate ? (
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
        <View style={[styles.tail, { backgroundColor: color }]} />
      </Animated.View>
    ) : null}
    <View
      style={[
        styles.dot,
        { backgroundColor: color, borderColor: selected ? '#FFD60A' : delay !== 'none' ? DELAY_COLORS[delay] : '#FFFFFF' },
      ]}
    />
  </View>
);

const styles = StyleSheet.create({
  box: { width: BOX, height: BOX, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    width: SIZE + 10,
    height: SIZE + 10,
    borderRadius: (SIZE + 10) / 2,
    borderWidth: 3,
  },
  tip: {
    position: 'absolute',
    top: TIP_TOP + 2,
    left: BOX / 2 - TIP_HALF_WIDTH + 2.5,
    width: 0,
    height: 0,
    borderLeftWidth: TIP_HALF_WIDTH - 2.5,
    borderRightWidth: TIP_HALF_WIDTH - 2.5,
    borderBottomWidth: TIP_HEIGHT - 2,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  tipOutline: {
    top: TIP_TOP - 1,
    left: BOX / 2 - TIP_HALF_WIDTH,
    borderLeftWidth: TIP_HALF_WIDTH,
    borderRightWidth: TIP_HALF_WIDTH,
    borderBottomWidth: TIP_HEIGHT,
  },
  body: {
    minWidth: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 2,
    paddingHorizontal: 3,
  },
  wide: { minWidth: SIZE + 6 },
  square: { borderRadius: 7 },
  dashed: { borderStyle: 'dashed' },
  diamond: {
    width: SIZE - 4,
    height: SIZE - 4,
    borderRadius: 4,
    borderWidth: 2,
    transform: [{ rotate: '45deg' }],
  },
  selected: { borderWidth: 3 },
  label: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  text: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  smallText: { fontSize: 11 },
  dotBox: { width: DOT_BOX, height: DOT_BOX, alignItems: 'center', justifyContent: 'center' },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 2 },
  tail: {
    position: 'absolute',
    top: DOT_BOX / 2,
    left: DOT_BOX / 2 - 1.5,
    width: 3,
    height: DOT_BOX / 2 - 2,
    borderRadius: 1.5,
    opacity: 0.6,
  },
});
