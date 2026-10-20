import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { LiveVehicle } from '../core/realtime/types';
import { LineBadge } from './line-badge';
import { useTheme } from './theme';

const SOURCES: Record<LiveVehicle['source'], string> = {
  mpk: 'MPK',
  merged: 'MPK + Open Data',
  'open-data': 'Open Data',
  klosok: 'Kłosok',
};

const age = (positionAt: number, now: number) => {
  const seconds = Math.max(0, Math.round((now - positionAt) / 1000));
  return seconds < 60 ? `${seconds} с назад` : `${Math.round(seconds / 60)} мин назад`;
};

const delayText = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  if (minutes === 0) return 'по расписанию';
  return minutes > 0 ? `опаздывает на ${minutes} мин` : `раньше на ${-minutes} мин`;
};

export function VehicleCard({
  vehicle,
  headsign,
  nextStop,
  now,
  onClose,
}: {
  vehicle: LiveVehicle;
  /** From the feed, or from the route variant the vehicle was matched to. */
  headsign: string | null;
  nextStop: string | null;
  now: number;
  onClose: () => void;
}) {
  const theme = useTheme();
  const details = [
    vehicle.vehicleNumber ? `№ ${vehicle.vehicleNumber}` : null,
    vehicle.brigade ? `бриг. ${vehicle.brigade}` : null,
    SOURCES[vehicle.source],
    age(vehicle.positionAt, now),
  ].filter(Boolean);

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.row}>
        <LineBadge line={vehicle.line} tram={vehicle.tram} />
        <View style={styles.middle}>
          <Text style={[styles.headsign, { color: theme.text }]} numberOfLines={1}>
            {headsign ? `→ ${headsign}` : 'Направление не определено'}
          </Text>
          {nextStop ? (
            <Text style={[styles.sub, { color: theme.muted }]} numberOfLines={1}>
              следующая: {nextStop}
            </Text>
          ) : null}
        </View>
        <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Закрыть">
          <Text style={[styles.close, { color: theme.muted }]}>✕</Text>
        </Pressable>
      </View>
      {vehicle.delaySeconds !== null ? (
        <Text style={[styles.delay, { color: vehicle.delaySeconds > 120 ? theme.amber : theme.text }]}>
          {delayText(vehicle.delaySeconds)}
        </Text>
      ) : null}
      <Text style={[styles.sub, { color: theme.muted }]}>{details.join(' · ')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  middle: { flex: 1, gap: 2 },
  headsign: { fontSize: 17, fontWeight: '600' },
  sub: { fontSize: 13 },
  delay: { fontSize: 15, fontWeight: '600' },
  close: { fontSize: 18, fontWeight: '600', paddingHorizontal: 4 },
});
