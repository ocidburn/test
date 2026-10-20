import { Link, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { searchStops, type StopSearchResult } from '../core/gtfs/queries';
import { useTimetable } from '../state/timetable';
import { LineBadge } from '../ui/line-badge';
import { StatusBanner } from '../ui/status-banner';
import { useTheme } from '../ui/theme';

export default function StopSearchScreen() {
  const theme = useTheme();
  const db = useTimetable((state) => state.db);
  const status = useTimetable((state) => state.status);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StopSearchResult[]>([]);

  useEffect(() => {
    if (!db || !query.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchStops(db, query)
        .then((rows) => !cancelled && setResults(rows))
        .catch(() => !cancelled && setResults([]));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [db, query]);

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable hitSlop={12} accessibilityLabel="Расписание">
                <Text style={{ color: theme.accent, fontSize: 16 }}>Данные</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      <StatusBanner />
      <View style={styles.searchWrap}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={status === 'ready' ? 'Название остановки' : 'Ждём расписание…'}
          placeholderTextColor={theme.muted}
          editable={status === 'ready'}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          returnKeyType="search"
          style={[styles.search, { backgroundColor: theme.inputBackground, color: theme.text }]}
        />
      </View>
      <FlatList
        data={query.trim() ? results : []}
        keyExtractor={(item) => item.name}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: theme.border }]} />}
        ListEmptyComponent={
          query.trim() && status === 'ready' ? (
            <Text style={[styles.empty, { color: theme.muted }]}>Ничего не нашлось</Text>
          ) : undefined
        }
        renderItem={({ item }) => (
          <Link href={{ pathname: '/stop/[name]', params: { name: item.name } }} asChild>
            <Pressable style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.inputBackground : theme.surface }]}>
              <Text style={[styles.name, { color: theme.text }]}>{item.name}</Text>
              <View style={styles.lines}>
                {item.lines.slice(0, 14).map((line) => (
                  <LineBadge key={line.name} line={line.name} tram={line.tram} size="small" />
                ))}
                {item.lines.length > 14 ? (
                  <Text style={{ color: theme.muted, fontSize: 12 }}>+{item.lines.length - 14}</Text>
                ) : null}
              </View>
            </Pressable>
          </Link>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  searchWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  search: { height: 44, borderRadius: 12, paddingHorizontal: 14, fontSize: 17 },
  list: { paddingBottom: 32 },
  row: { paddingHorizontal: 16, paddingVertical: 12, gap: 6 },
  name: { fontSize: 17, fontWeight: '600' },
  lines: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  empty: { textAlign: 'center', marginTop: 32, fontSize: 15 },
});
