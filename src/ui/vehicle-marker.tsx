import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { lineColor } from './theme';

const SIZE = 30;
const BOX = 44;

/**
 * A line-coloured disc with the line number, and a small arrowhead on the
 * rim pointing where the vehicle is heading (none while it is unknown).
 * Only the arrow rotates, so the number stays upright.
 */
export const VehicleMarker = memo(function VehicleMarker({
  line,
  tram,
  heading,
  selected,
}: {
  line: string;
  tram: boolean;
  heading: number | null;
  selected: boolean;
}) {
  const color = lineColor(line, tram);
  const long = line.length > 2;
  return (
    <View style={styles.box} pointerEvents="none">
      {heading !== null ? (
        <View style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${Math.round(heading)}deg` }] }]}>
          <View style={[styles.arrow, { borderBottomColor: color }]} />
        </View>
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
  );
});

const styles = StyleSheet.create({
  box: { width: BOX, height: BOX, alignItems: 'center', justifyContent: 'center' },
  arrow: {
    position: 'absolute',
    top: 0,
    left: BOX / 2 - 6,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
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
