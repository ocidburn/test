import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatDateKey } from '../core/time/warsaw';
import { lastCheckedAt } from '../platform/timetable';
import { useTimetable } from '../state/timetable';
import { StatusBanner } from '../ui/status-banner';
import { useTheme } from '../ui/theme';

const formatInstant = (ms: number | null) => {
  if (!ms) return '—';
  const date = new Date(ms);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString().slice(0, 5)}`;
};

const REASONS: Record<string, string> = {
  'installed timetable is the best available': 'Установлено актуальное расписание',
  'no better snapshot found': 'Новее ничего нет',
  'no usable snapshot found': 'Портал не отдал пригодного архива',
};

export default function SettingsScreen() {
  const theme = useTheme();
  const meta = useTimetable((state) => state.meta);
  const activity = useTimetable((state) => state.activity);
  const lastResult = useTimetable((state) => state.lastResult);
  const log = useTimetable((state) => state.log);
  const update = useTimetable((state) => state.update);

  const rows: [string, string][] = [
    ['Снимок', meta?.sourceName ?? '—'],
    ['Действует', meta?.feedStart && meta?.feedEnd ? `${formatDateKey(meta.feedStart)} — ${formatDateKey(meta.feedEnd)}` : '—'],
    ['Импортировано', formatInstant(meta?.importedAt ?? null)],
    ['Проверено', formatInstant(lastCheckedAt())],
    ['Линий', String(meta?.counts?.routes ?? '—')],
    ['Остановок (słupki)', String(meta?.counts?.stops ?? '—')],
    ['Рейсов', String(meta?.counts?.trips ?? '—')],
    ['Строк расписания', String(meta?.counts?.stopTimes ?? '—')],
  ];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <StatusBanner />
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        {rows.map(([label, value]) => (
          <View key={label} style={[styles.row, { borderColor: theme.border }]}>
            <Text style={{ color: theme.muted, fontSize: 15 }}>{label}</Text>
            <Text style={{ color: theme.text, fontSize: 15, flexShrink: 1, textAlign: 'right' }} selectable>
              {value}
            </Text>
          </View>
        ))}
      </View>
      <Pressable
        disabled={!!activity}
        onPress={() => void update({ force: true })}
        style={({ pressed }) => [styles.button, { backgroundColor: theme.accent, opacity: activity ? 0.5 : pressed ? 0.8 : 1 }]}
      >
        <Text style={styles.buttonText}>Проверить обновление</Text>
      </Pressable>
      {lastResult ? <Text style={[styles.note, { color: theme.muted }]}>{REASONS[lastResult] ?? lastResult}</Text> : null}
      {log.length ? (
        <View style={[styles.card, { backgroundColor: theme.surface, padding: 12 }]}>
          {log.map((line, index) => (
            <Text key={index} style={{ color: theme.muted, fontSize: 12 }} selectable>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
      <Text style={[styles.note, { color: theme.muted }]}>
        Данные: Otwarte Dane Wrocław (GTFS). Приложение работает без своего сервера: расписание хранится на телефоне.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 40, gap: 12 },
  card: { marginHorizontal: 16, borderRadius: 12, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  button: { marginHorizontal: 16, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  note: { marginHorizontal: 20, fontSize: 13 },
});
