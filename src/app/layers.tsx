import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { useLive } from '../state/live';
import { BasemapPicker } from '../ui/basemap-picker';
import { OfflineCard } from '../ui/offline-card';
import { useTheme } from '../ui/theme';
import { DELAY_COLORS } from '../ui/vehicle-marker';

/** What the map draws: its base layer, the delay badges, and offline tiles. */
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
            <Legend color={DELAY_COLORS.ok} label="вовремя" muted={theme.muted} dot />
            <Legend color={DELAY_COLORS.mid} label="+2…5 мин" text="+3" dark muted={theme.muted} />
            <Legend color={DELAY_COLORS.late} label="больше 5" text="+8" muted={theme.muted} />
            <Legend color={DELAY_COLORS.early} label="раньше" text="−2" muted={theme.muted} />
          </View>
        ) : null}
        <Text style={{ color: theme.muted, fontSize: 13 }}>
          Минуты у значка машины, только когда она идёт не по расписанию; зелёная точка — вовремя. Без отметки —
          рейс не найден, опоздание не угадывается. При отдалении точки красятся по опозданию (серые — без рейса).
        </Text>
      </View>
      <OfflineCard />
    </ScrollView>
  );
}

const Legend = ({
  color,
  label,
  muted,
  text,
  dark,
  dot,
}: {
  color: string;
  label: string;
  muted: string;
  text?: string;
  dark?: boolean;
  dot?: boolean;
}) => (
  <View style={styles.legendItem}>
    {dot ? (
      <View style={[styles.legendDot, { backgroundColor: color }]} />
    ) : (
      <View style={[styles.legendBadge, { backgroundColor: color }]}>
        <Text style={{ color: dark ? '#1F2937' : '#FFFFFF', fontSize: 11, fontWeight: '800' }}>{text}</Text>
      </View>
    )}
    <Text style={{ color: muted, fontSize: 13 }}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 20 },
  layer: { borderRadius: 12, padding: 12, gap: 8 },
  layerRow: { flexDirection: 'row', alignItems: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 11, height: 11, borderRadius: 5.5 },
  legendBadge: { minWidth: 24, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
});
