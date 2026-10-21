import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { useLive } from '../state/live';
import { BasemapPicker } from '../ui/basemap-picker';
import { OfflineCard } from '../ui/offline-card';
import { useTheme } from '../ui/theme';
import { DELAY_COLORS } from '../ui/vehicle-marker';

/** What the map draws: its base layer, the delay rings, and offline tiles. */
export default function LayersScreen() {
  const theme = useTheme();
  const showDelays = useLive((state) => state.showDelays);
  const setShowDelays = useLive((state) => state.setShowDelays);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <BasemapPicker />
      <View style={[styles.layer, { backgroundColor: theme.surface }]}>
        <View style={styles.layerRow}>
          <Text style={{ color: theme.text, fontSize: 16, flex: 1 }}>Опоздания на карте</Text>
          <Switch value={showDelays} onValueChange={setShowDelays} />
        </View>
        {showDelays ? (
          <View style={styles.legend}>
            <Legend color={DELAY_COLORS.ok} label="до 2 мин" muted={theme.muted} />
            <Legend color={DELAY_COLORS.mid} label="2–5 мин" muted={theme.muted} />
            <Legend color={DELAY_COLORS.late} label="больше 5" muted={theme.muted} />
            <Legend color={DELAY_COLORS.none} label="нет данных" muted={theme.muted} />
          </View>
        ) : null}
        <Text style={{ color: theme.muted, fontSize: 13 }}>
          Кольцо вокруг машины. Серое — рейс не определён, опоздание не угадывается.
        </Text>
      </View>
      <OfflineCard />
    </ScrollView>
  );
}

const Legend = ({ color, label, muted }: { color: string; label: string; muted: string }) => (
  <View style={styles.legendItem}>
    <View style={[styles.legendRing, { borderColor: color }]} />
    <Text style={{ color: muted, fontSize: 13 }}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 20 },
  layer: { borderRadius: 12, padding: 12, gap: 8 },
  layerRow: { flexDirection: 'row', alignItems: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendRing: { width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
});
