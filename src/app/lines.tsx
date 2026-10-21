import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LINE_GROUPS, lineGroup } from '../core/line-groups';
import { useLive } from '../state/live';
import { lineColor, useTheme } from '../ui/theme';

/**
 * Which lines the map shows, by group. A filled cell is shown; each group can
 * be selected or cleared whole, and a group with nothing selected shows
 * nothing on the map.
 */
export default function LinesScreen() {
  const theme = useTheme();
  const lines = useLive((state) => state.lines);
  const hidden = useLive((state) => state.hidden);
  const vehicles = useLive((state) => state.vehicles);
  const toggleLine = useLive((state) => state.toggleLine);
  const setHidden = useLive((state) => state.setHidden);

  const live = useMemo(() => {
    const counts = new Map<string, number>();
    for (const vehicle of vehicles) counts.set(vehicle.line, (counts.get(vehicle.line) ?? 0) + 1);
    return counts;
  }, [vehicles]);
  const hiddenSet = new Set(hidden);
  const shownCount = lines.filter((line) => !hiddenSet.has(line.name)).length;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.actions}>
        <Text style={{ color: theme.muted, flex: 1 }}>
          {hidden.length ? `Показано линий: ${shownCount} из ${lines.length}` : 'Показаны все линии'}
        </Text>
        {hidden.length ? (
          <Pressable onPress={() => setHidden([])} hitSlop={10}>
            <Text style={{ color: theme.accent, fontSize: 16 }}>Показать все</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => setHidden(lines.map((line) => line.name))} hitSlop={10}>
            <Text style={{ color: theme.accent, fontSize: 16 }}>Скрыть все</Text>
          </Pressable>
        )}
      </View>
      {lines.length === 0 ? <Text style={{ color: theme.muted, padding: 16 }}>Линии появятся после загрузки расписания.</Text> : null}
      {LINE_GROUPS.map(({ group, title }) => {
        const items = lines.filter((line) => lineGroup(line.name, line.tram) === group);
        if (!items.length) return null;
        const names = items.map((line) => line.name);
        const shown = names.filter((name) => !hiddenSet.has(name)).length;
        const all = shown === names.length;
        const onMap = items.reduce((sum, line) => sum + (hiddenSet.has(line.name) ? 0 : (live.get(line.name) ?? 0)), 0);
        return (
          <View key={group} style={styles.group}>
            <View style={styles.groupHeader}>
              <View style={styles.groupTitle}>
                <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
                <Text style={{ color: theme.muted, fontSize: 13 }}>
                  {shown === 0 ? 'не показаны' : `${shown} из ${names.length} · на карте ${onMap}`}
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  setHidden(all ? [...new Set([...hidden, ...names])] : hidden.filter((name) => !names.includes(name)))
                }
                style={[styles.groupToggle, { borderColor: theme.accent, backgroundColor: all ? theme.accent : 'transparent' }]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: all ? true : shown === 0 ? false : 'mixed' }}
                accessibilityLabel={`${title}: все`}
                hitSlop={6}
              >
                <Text style={{ color: all ? '#FFFFFF' : theme.accent, fontWeight: '600', fontSize: 14 }}>
                  {all ? '✓ Все' : shown === 0 ? 'Выбрать все' : 'Все'}
                </Text>
              </Pressable>
            </View>
            <View style={styles.grid}>
              {items.map((line) => {
                const on = !hiddenSet.has(line.name);
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
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  groupTitle: { flex: 1, gap: 1 },
  groupToggle: { borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  title: { fontSize: 17, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: 64, height: 52, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  line: { fontSize: 17, fontWeight: '800' },
  count: { fontSize: 11 },
});
