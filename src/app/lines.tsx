import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { lineToType } from '../core/lines';
import { useLive } from '../state/live';
import { lineColor, useTheme } from '../ui/theme';

const GROUPS: { title: string; test: (line: string, tram: boolean) => boolean }[] = [
  { title: 'Трамваи', test: (_line, tram) => tram },
  { title: 'Автобусы', test: (line, tram) => !tram && ['bus', 'busExpress', 'busSpecial', 'busTemporary', 'unknown'].includes(lineToType(line)) },
  { title: 'Пригородные', test: (line, tram) => !tram && ['busSuburban', 'busZone'].includes(lineToType(line)) },
  { title: 'Ночные', test: (line, tram) => !tram && lineToType(line) === 'busNight' },
];

export default function LinesScreen() {
  const theme = useTheme();
  const lines = useLive((state) => state.lines);
  const filter = useLive((state) => state.filter);
  const vehicles = useLive((state) => state.vehicles);
  const toggleLine = useLive((state) => state.toggleLine);
  const setFilter = useLive((state) => state.setFilter);

  const live = useMemo(() => {
    const counts = new Map<string, number>();
    for (const vehicle of vehicles) counts.set(vehicle.line, (counts.get(vehicle.line) ?? 0) + 1);
    return counts;
  }, [vehicles]);
  const selected = new Set(filter);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.actions}>
        <Text style={{ color: theme.muted, flex: 1 }}>
          {filter.length ? `Выбрано: ${filter.length}` : 'Показаны все линии'}
        </Text>
        {filter.length ? (
          <Pressable onPress={() => setFilter([])} hitSlop={10}>
            <Text style={{ color: theme.accent, fontSize: 16 }}>Сбросить</Text>
          </Pressable>
        ) : null}
      </View>
      {lines.length === 0 ? <Text style={{ color: theme.muted, padding: 16 }}>Линии появятся после загрузки расписания.</Text> : null}
      {GROUPS.map((group) => {
        const items = lines.filter((line) => group.test(line.name, line.tram));
        if (!items.length) return null;
        return (
          <View key={group.title} style={styles.group}>
            <Text style={[styles.title, { color: theme.text }]}>{group.title}</Text>
            <View style={styles.grid}>
              {items.map((line) => {
                const on = selected.has(line.name);
                const color = lineColor(line.name, line.tram);
                const count = live.get(line.name) ?? 0;
                return (
                  <Pressable
                    key={line.name}
                    onPress={() => toggleLine(line.name)}
                    style={[
                      styles.cell,
                      { borderColor: color, backgroundColor: on ? color : theme.surface, opacity: count || on ? 1 : 0.55 },
                    ]}
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.line, { color: on ? '#FFFFFF' : color }]}>{line.name}</Text>
                    <Text style={[styles.count, { color: on ? '#FFFFFF' : theme.muted }]}>{count || '—'}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 20 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  group: { gap: 10 },
  title: { fontSize: 17, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: 64, height: 52, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  line: { fontSize: 17, fontWeight: '800' },
  count: { fontSize: 11 },
});
