import { memo, useEffect, useState, type ComponentType } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { AnimatedRegion, MarkerAnimated, type LatLng, type MapMarkerProps } from 'react-native-maps';

import { distanceMeters } from '../core/geo';
import { lineColor } from './theme';

const SIZE = 30;
const BOX = 58;
const ARROW_HALF_WIDTH = 9;
const ARROW_HEIGHT = 12;
/** How long a marker takes to glide to its new position. Polls are 10 s apart. */
export const MOVE_MS = 3000;
/** Further than this between two polls is a GPS jump or a source switch: no glide. */
const TELEPORT_METERS = 1000;

// The animated marker's typings drop `children`; it renders them like a plain Marker.
const AnimatedMarker = MarkerAnimated as unknown as ComponentType<MapMarkerProps>;

/** The shortest turn from `from` (any real number of degrees) to the bearing `to`. */
const shortestTurn = (from: number, to: number) => from + ((((to - from) % 360) + 540) % 360) - 180;

/**
 * A line-coloured disc with the number, and an arrowhead on the rim pointing
 * where the vehicle is heading (hidden while unknown). Only the arrow
 * rotates, so the number stays upright. The marker glides to each new
 * position and the arrow turns the short way round.
 */
export const VehicleMarker = memo(function VehicleMarker({
  id,
  line,
  tram,
  lat,
  lon,
  heading,
  selected,
  onSelect,
}: {
  id: string;
  line: string;
  tram: boolean;
  lat: number;
  lon: number;
  heading: number | null;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  // Created once per marker; later positions arrive through timing animations.
  const [anim] = useState(() => ({
    region: new AnimatedRegion({ latitude: lat, longitude: lon, latitudeDelta: 0, longitudeDelta: 0 }),
    rotation: new Animated.Value(heading ?? 0),
    target: { lat, lon, rotation: heading ?? 0 },
  }));

  useEffect(() => {
    const { target, region } = anim;
    if (target.lat === lat && target.lon === lon) return;
    const jump = distanceMeters(target.lat, target.lon, lat, lon) > TELEPORT_METERS;
    target.lat = lat;
    target.lon = lon;
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
    const next = shortestTurn(anim.target.rotation, heading);
    if (next === anim.target.rotation) return;
    anim.target.rotation = next;
    Animated.timing(anim.rotation, {
      toValue: next,
      duration: 600,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [anim, heading]);

  const color = lineColor(line, tram);
  const long = line.length > 2;
  const rotate = anim.rotation.interpolate({ inputRange: [-36_000, 36_000], outputRange: ['-36000deg', '36000deg'] });

  return (
    <AnimatedMarker
      // AnimatedRegion drives the coordinate; the typings only know plain LatLng.
      coordinate={anim.region as unknown as LatLng}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={selected ? 1000 : 10}
      onPress={(event) => {
        event.stopPropagation();
        onSelect(id);
      }}
    >
      <View style={styles.box} pointerEvents="none">
        {heading !== null ? (
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
            {/* A white arrow under the coloured one gives it an outline on any map. */}
            <View style={[styles.arrow, styles.arrowOutline]} />
            <View style={[styles.arrow, { borderBottomColor: color }]} />
          </Animated.View>
        ) : null}
        <View
          style={[
            styles.disc,
            long && styles.wide,
            { backgroundColor: color, borderColor: selected ? '#FFD60A' : '#FFFFFF' },
            selected && styles.selected,
          ]}
        >
          <Text style={[styles.text, long && styles.smallText]} numberOfLines={1}>
            {line}
          </Text>
        </View>
      </View>
    </AnimatedMarker>
  );
});

const styles = StyleSheet.create({
  box: { width: BOX, height: BOX, alignItems: 'center', justifyContent: 'center' },
  arrow: {
    position: 'absolute',
    top: 3,
    left: BOX / 2 - ARROW_HALF_WIDTH,
    width: 0,
    height: 0,
    borderLeftWidth: ARROW_HALF_WIDTH,
    borderRightWidth: ARROW_HALF_WIDTH,
    borderBottomWidth: ARROW_HEIGHT,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  arrowOutline: {
    top: 0,
    left: BOX / 2 - ARROW_HALF_WIDTH - 3,
    borderLeftWidth: ARROW_HALF_WIDTH + 3,
    borderRightWidth: ARROW_HALF_WIDTH + 3,
    borderBottomWidth: ARROW_HEIGHT + 4,
    borderBottomColor: '#FFFFFF',
  },
  disc: {
    minWidth: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  wide: { minWidth: SIZE + 6 },
  selected: { borderWidth: 3 },
  text: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  smallText: { fontSize: 11 },
});
