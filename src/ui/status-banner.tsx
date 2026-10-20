import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { describeActivity, useTimetable } from '../state/timetable';
import { useTheme } from './theme';

/** What the timetable is doing right now: nothing when idle and healthy. */
export function StatusBanner() {
  const theme = useTheme();
  const activity = useTimetable((state) => state.activity);
  const status = useTimetable((state) => state.status);
  const lastError = useTimetable((state) => state.lastError);

  const text = describeActivity(activity);
  if (text) {
    const fraction =
      activity?.stage === 'importing' ? activity.progress.fraction : activity?.stage === 'downloading' ? activity.fraction : null;
    return (
      <View style={[styles.banner, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.row}>
          <ActivityIndicator size="small" color={theme.accent} />
          <Text style={[styles.text, { color: theme.text }]}>{text}</Text>
        </View>
        {fraction !== null && fraction !== undefined ? (
          <View style={[styles.track, { backgroundColor: theme.inputBackground }]}>
            <View style={[styles.fill, { backgroundColor: theme.accent, width: `${Math.round(fraction * 100)}%` }]} />
          </View>
        ) : null}
        {status === 'empty' ? (
          <Text style={[styles.hint, { color: theme.muted }]}>
            Первый импорт занимает пару минут. Потом всё работает без сети.
          </Text>
        ) : null}
      </View>
    );
  }

  if (lastError) {
    return (
      <View style={[styles.banner, { backgroundColor: theme.surface, borderColor: theme.danger }]}>
        <Text style={[styles.text, { color: theme.danger }]}>
          {status === 'ready' ? 'Не удалось обновить расписание, работаю на сохранённом.' : 'Не удалось загрузить расписание.'}
        </Text>
        <Text style={[styles.hint, { color: theme.muted }]} numberOfLines={3}>
          {lastError}
        </Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  banner: { marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { fontSize: 15, fontWeight: '500' },
  hint: { fontSize: 13 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4 },
});
