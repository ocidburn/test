import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getDepartures, getStopPosts, type Departure, type StopPost } from '../../core/gtfs/queries';
import { formatClock } from '../../core/time/warsaw';
import { useTimetable } from '../../state/timetable';
import { LineBadge } from '../../ui/line-badge';
import { useTheme } from '../../ui/theme';

const REFRESH_MS = 30_000;

const useNow = (intervalMs: number) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
};

const countdown = (at: number, now: number) => {
  const minutes = Math.floor((at - now) / 60_000);
  if (minutes <= 0) return 'сейчас';
  if (minutes < 60) return `${minutes} мин`;
  return formatClock(at);
};

export default function StopScreen() {
  const theme = useTheme();
  const { name } = useLocalSearchParams<{ name: string }>();
  const db = useTimetable((state) => state.db);
  const [posts, setPosts] = useState<StopPost[]>([]);
  const [selectedPost, setSelectedPost] = useState<number | null>(null);
  const [departures, setDepartures] = useState<Departure[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow(15_000);

  useEffect(() => {
    if (!db || !name) return;
    getStopPosts(db, name).then(setPosts).catch(() => setPosts([]));
  }, [db, name]);

  const stopIdxs = useMemo(
    () => (selectedPost === null ? posts.map((post) => post.stopIdx) : [selectedPost]),
    [posts, selectedPost],
  );

  const fetchDepartures = useCallback(
    () => (db && stopIdxs.length ? getDepartures(db, stopIdxs, { windowMinutes: 180, limit: 80 }) : Promise.resolve([])),
    [db, stopIdxs],
  );

  useEffect(() => {
    let cancelled = false;
    const run = () =>
      fetchDepartures()
        .then((rows) => {
          if (cancelled) return;
          setDepartures(rows);
          setLoaded(true);
        })
        .catch(() => {});
    run();
    const timer = setInterval(run, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [fetchDepartures]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      setDepartures(await fetchDepartures());
    } finally {
      setRefreshing(false);
    }
  };

  const visible = departures.filter((departure) => departure.at >= now - 60_000);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: name ?? '' }} />
      {posts.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipBar}>
          {[{ stopIdx: null as number | null, label: 'Все' }, ...posts.map((post) => ({ stopIdx: post.stopIdx as number | null, label: post.code ?? post.stopId }))].map(
            (chip) => {
              const active = chip.stopIdx === selectedPost;
              return (
                <Pressable
                  key={String(chip.stopIdx)}
                  onPress={() => setSelectedPost(chip.stopIdx)}
                  style={[styles.chip, { backgroundColor: active ? theme.accent : theme.inputBackground }]}
                >
                  <Text style={{ color: active ? '#FFFFFF' : theme.text, fontWeight: '600' }}>{chip.label}</Text>
                </Pressable>
              );
            },
          )}
        </ScrollView>
      ) : null}
      <FlatList
        data={visible}
        keyExtractor={(item) => `${item.tripIdx}-${item.serviceDay}-${item.stopIdx}`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: theme.border }]} />}
        ListEmptyComponent={
          loaded ? (
            <Text style={[styles.empty, { color: theme.muted }]}>Ближайшие 3 часа отправлений нет</Text>
          ) : undefined
        }
        renderItem={({ item }) => {
          const soon = item.at - now < 15 * 60_000;
          return (
            <View style={[styles.row, { backgroundColor: theme.surface }]}>
              <LineBadge line={item.line} tram={item.tram} />
              <View style={styles.middle}>
                <Text style={[styles.headsign, { color: theme.text }]} numberOfLines={1}>
                  {item.headsign ?? '—'}
                </Text>
                {posts.length > 1 && selectedPost === null ? (
                  <Text style={[styles.post, { color: theme.muted }]}>
                    słupek {item.stopCode ?? ''} · {formatClock(item.at)}
                  </Text>
                ) : (
                  <Text style={[styles.post, { color: theme.muted }]}>{formatClock(item.at)}</Text>
                )}
              </View>
              <Text style={[styles.time, { color: soon ? theme.amber : theme.text }]}>{countdown(item.at, now)}</Text>
            </View>
          );
        }}
      />
      <Text style={[styles.footnote, { color: theme.muted }]}>По расписанию · живые данные появятся на этапе 3</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  chipBar: { flexGrow: 0 },
  chips: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: 17, justifyContent: 'center' },
  list: { paddingBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  middle: { flex: 1, gap: 2 },
  headsign: { fontSize: 17, fontWeight: '500' },
  post: { fontSize: 13 },
  time: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 68 },
  empty: { textAlign: 'center', marginTop: 32, fontSize: 15 },
  footnote: { textAlign: 'center', fontSize: 12, paddingVertical: 8 },
});
