import { memo, useEffect, useRef, useState, type ComponentType } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { AnimatedRegion, MarkerAnimated, type LatLng, type MapMarkerProps } from 'react-native-maps';

import { distanceMeters } from '../core/geo';
import type { DelayStatus } from '../core/realtime/trip-match';
import { lineColor } from './theme';

/** Room for the drop's point (27 from the centre) at any angle, and the delay ring. */
const BOX = 60;
const DOT_BOX = 44;
/** Length of a dot's trail behind it. */
const TRAIL = 18;
const SELECTED_RIM = '#FFD60A';
/** How long a marker takes to glide to its new position. Polls are 10 s apart. */
export const MOVE_MS = 3000;
/** Further than this between two polls is a GPS jump or a source switch: no glide. */
const TELEPORT_METERS = 1000;

/** Ring colours of the delay layer; grey when the run, and so the delay, is not known. */
export const DELAY_COLORS: Record<DelayStatus, string> = {
  ok: '#16A34A',
  mid: '#F59E0B',
  late: '#DC2626',
  none: '#9CA3AF',
};

// The animated marker's typings drop `children`; it renders them like a plain Marker.
const AnimatedMarker = MarkerAnimated as unknown as ComponentType<MapMarkerProps>;

/** The shortest turn from `from` (any real number of degrees) to the bearing `to`. */
const shortestTurn = (from: number, to: number) => from + ((((to - from) % 360) + 540) % 360) - 180;

export type MarkerStyle = 'drop' | 'dot';

/**
 * A vehicle on the map (variant B of the marker study).
 *
 * `drop`: the whole marker is one drop in the line's colour, drawn out to a
 * point where the vehicle is heading; the number stays upright. Same shape for
 * every kind — the colour tells tram, bus, express and night apart. While the
 * heading is unknown the drop has no point: a plain circle.
 *
 * `dot`: for a zoomed-out map, a small dot with a trail fading out behind it.
 *
 * With the delay layer on, a ring (drop) or the rim (dot) shows how late the
 * run is, grey when that is not known. The marker glides to each new
 * position; `offset` (screen points) only moves where it is drawn, to keep
 * it clear of its neighbours.
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
  /** The delay layer's ring; null while the layer is off. */
  delay: DelayStatus | null;
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
        <Dot id={id} color={color} delay={delay} selected={selected} rotate={heading !== null ? rotate : null} />
      ) : (
        <Drop line={line} color={color} delay={delay} selected={selected} rotate={heading !== null ? rotate : null} />
      )}
    </AnimatedMarker>
  );
});

type Rotation = Animated.AnimatedInterpolation<string> | null;

/** One drop for every kind: a circle of radius 15 drawn out to a point 27 from its centre. */
const DROP_PATH = 'M0,-27 C5,-21 15,-13 15,0 A15,15 0 1,1 -15,0 C-15,-13 -5,-21 0,-27 Z';
const HALF = BOX / 2;

const Drop = ({
  line,
  color,
  delay,
  selected,
  rotate,
}: {
  line: string;
  color: string;
  delay: DelayStatus | null;
  selected: boolean;
  rotate: Rotation;
}) => {
  const rim = selected ? SELECTED_RIM : '#FFFFFF';
  const rimWidth = selected ? 3 : 2;
  return (
    <View style={styles.box} pointerEvents="none">
      {delay !== null ? (
        <Svg width={BOX} height={BOX} viewBox={`${-HALF} ${-HALF} ${BOX} ${BOX}`} style={StyleSheet.absoluteFill}>
          <Circle r={20} fill="none" stroke="#FFFFFF" strokeWidth={6} />
          <Circle r={20} fill="none" stroke={DELAY_COLORS[delay]} strokeWidth={3.5} />
        </Svg>
      ) : null}
      {rotate ? (
        // The whole silhouette turns with the heading; the number below does not.
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
          <Svg width={BOX} height={BOX} viewBox={`${-HALF} ${-HALF} ${BOX} ${BOX}`}>
            <Path d={DROP_PATH} fill={color} stroke={rim} strokeWidth={rimWidth} strokeLinejoin="round" />
          </Svg>
        </Animated.View>
      ) : (
        // Heading not known yet: the drop without its point.
        <Svg width={BOX} height={BOX} viewBox={`${-HALF} ${-HALF} ${BOX} ${BOX}`} style={StyleSheet.absoluteFill}>
          <Circle r={15} fill={color} stroke={rim} strokeWidth={rimWidth} />
        </Svg>
      )}
      <View style={styles.label}>
        <Text style={[styles.text, line.length > 2 && styles.smallText]} numberOfLines={1}>
          {line}
        </Text>
      </View>
    </View>
  );
};

const Dot = ({
  id,
  color,
  delay,
  selected,
  rotate,
}: {
  id: string;
  color: string;
  delay: DelayStatus | null;
  selected: boolean;
  rotate: Rotation;
}) => {
  const gradient = `trail-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const half = DOT_BOX / 2;
  return (
    <View style={styles.dotBox} pointerEvents="none">
      {rotate ? (
        // A trail fading out behind the dot: drawn pointing south, turned to the heading.
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
          <Svg width={DOT_BOX} height={DOT_BOX} viewBox={`${-half} ${-half} ${DOT_BOX} ${DOT_BOX}`}>
            <Defs>
              <LinearGradient id={gradient} x1="0" y1="0" x2="0" y2={TRAIL} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={color} stopOpacity={0.85} />
                <Stop offset="1" stopColor={color} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={`M0,0 L0,${TRAIL}`} stroke={`url(#${gradient})`} strokeWidth={6} strokeLinecap="round" />
          </Svg>
        </Animated.View>
      ) : null}
      <Svg width={DOT_BOX} height={DOT_BOX} viewBox={`${-half} ${-half} ${DOT_BOX} ${DOT_BOX}`} style={StyleSheet.absoluteFill}>
        <Circle
          r={6}
          fill={color}
          stroke={selected ? SELECTED_RIM : delay !== null ? DELAY_COLORS[delay] : '#FFFFFF'}
          strokeWidth={2}
        />
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  box: { width: BOX, height: BOX },
  label: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  text: { color: '#FFFFFF', fontWeight: '800', fontSize: 12.5 },
  smallText: { fontSize: 10.5 },
  dotBox: { width: DOT_BOX, height: DOT_BOX },
});
