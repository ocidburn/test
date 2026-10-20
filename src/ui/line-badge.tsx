import { StyleSheet, Text, View } from 'react-native';

import { lineColor } from './theme';

export function LineBadge({ line, tram, size = 'normal' }: { line: string; tram: boolean; size?: 'normal' | 'small' }) {
  const small = size === 'small';
  return (
    <View
      style={[styles.badge, small && styles.small, { backgroundColor: lineColor(line, tram) }]}
      accessibilityLabel={`${tram ? 'Трамвай' : 'Автобус'} ${line}`}
    >
      <Text style={[styles.text, small && styles.smallText]}>{line}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 40,
    height: 30,
    paddingHorizontal: 6,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: { minWidth: 28, height: 20, borderRadius: 5, paddingHorizontal: 4 },
  text: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  smallText: { fontSize: 12 },
});
