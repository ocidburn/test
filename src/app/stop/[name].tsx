import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getDepartures, getStopPosts, type Departure, type StopPost } from '../../core/gtfs/queries';
import { formatClock } from '../../core/time/warsaw';
import { buildActiveOn, liveDelaysForStop, type StopLive } from '../../platform/describe';
import { useFavorites } from '../../state/favorites';
import { useLive } from '../../state/live';
import { useReminders } from '../../state/reminders';
import { useTimetable } from '../../state/timetable';
import { LineBadge } from '../../ui/line-badge';
import { useTheme } from '../../ui/theme';
import { useNow } from '../../ui/use-now';

const REFRESH_MS = 30_000;

const countdown = (at: number, now: number) => {
  const minutes = Math.floor((at - now) / 60_000);
  if (minutes <= 0) return 'сейчас';
  if (minutes < 60) return `${minutes} мин`;
  return formatClock(at);
};

/** One departure row: a run, on its service day, at one post. */
const rowKey = (departure: { tripIdx: number; serviceDay: number; stopIdx: number }) =>
  `${departure.tripIdx}-${departure.serviceDay}-${departure.stopIdx}`;

const delayLabel = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  if (minutes === 0) return 'вовремя';
  return minutes > 0 ? `+${minutes} мин` : `${minutes} мин`;
};

export default function StopScreen() {
  const theme = useTheme();
  const { name } = useLocalSearchParams<{ name: string }>();
  const db = useTimetable((state) => state.db);
  const vehicles = useLive((state) => state.vehicles);
  const isFavorite = useFavorites((state) => (name ? state.stops.includes(name) : false));
  const toggleFavorite = useFavorites((state) => state.toggle);
  const reminders = useReminders((state) => state.items);
  const addReminder = useReminders((state) => state.add);
  const removeReminder = useReminders((state) => state.remove);
  const rescheduleReminder = useReminders((state) => state.reschedule);
  const [posts, setPosts] = useState<StopPost[]>([]);
  const [selectedPost, setSelectedPost] = useState<number | null>(null);
  const [departures, setDepartures] = useState<Departure[]>([]);
  const [live, setLive] = useState<Map<string, StopLive>>(new Map());
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

  // Live overlay: the real countdown and delay for any departure whose vehicle
  // is on the map right now, matched to its scheduled trip by the GTFS geometry.
  const lineSet = useMemo(() => new Set(departures.map((d) => d.line)), [departures]);
  const stopSet = useMemo(() => new Set(stopIdxs), [stopIdxs]);
  useEffect(() => {
    // Nothing to match: leave the last overlay, which the next poll refreshes
    // (stale entries only match by exact trip id, so they fall off on their own).
    if (!db || !stopSet.size || !lineSet.size || !vehicles.length) return;
    let cancelled = false;
    (async () => {
      const activeOn = await buildActiveOn(db, Date.now());
      const map = await liveDelaysForStop(db, stopSet, lineSet, vehicles, Date.now(), activeOn);
      if (!cancelled) setLive(map);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [db, stopSet, lineSet, vehicles]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      setDepartures(await fetchDepartures());
    } finally {
      setRefreshing(false);
    }
  };

  const rows = departures
    .map((departure) => {
      const match = live.get(String(departure.tripIdx));
      const at = match ? now + match.etaSeconds * 1000 : departure.at;
      return { departure, at, delaySeconds: match?.delaySeconds ?? null, isLive: !!match };
    })
    .filter((row) => row.at >= now - 60_000)
    .sort((a, b) => a.at - b.at);
  const liveCount = rows.filter((row) => row.isLive).length;
  const reminderByKey = new Map(reminders.map((reminder) => [reminder.key, reminder]));

  // While the board is open, a reminded run whose live estimate moved by
  // more than a minute gets its reminder moved too.
  const drift = rows
    .filter((row) => {
      const reminder = reminderByKey.get(rowKey(row.departure));
      return reminder && Math.abs(reminder.departAt - row.at) > 60_000;
    })
    .map((row) => `${rowKey(row.departure)}@${Math.round(row.at / 60_000)}`)
    .join(',');
  useEffect(() => {
    if (!drift) return;
    for (const entry of drift.split(',')) {
      const [key, minute] = entry.split('@');
      void rescheduleReminder(key, Number(minute) * 60_000).catch(() => {});
    }
  }, [drift, rescheduleReminder]);

  const onRowPress = (row: (typeof rows)[number]) => {
    const key = rowKey(row.departure);
    const title = `${row.departure.line}${row.departure.headsign ? ` → ${row.departure.headsign}` : ''}`;
    const existing = reminderByKey.get(key);
    if (existing) {
      Alert.alert(title, `Напоминание за ${existing.minutesBefore} мин до ${formatClock(existing.departAt)}`, [
        { text: 'Убрать напоминание', style: 'destructive', onPress: () => void removeReminder(key) },
        { text: 'Оставить', style: 'cancel' },
      ]);
      return;
    }
    const remind = (minutesBefore: number) =>
      addReminder(key, {
        stop: name ?? '',
        line: row.departure.line,
        headsign: row.departure.headsign,
        departAt: row.at,
        minutesBefore,
      }).catch((error: Error) => Alert.alert('Не получилось', error.message));
    Alert.alert(
      title,
      `Отправление в ${formatClock(row.at)}. Напомнить заранее?` +
        (row.isLive ? ' Время по текущей оценке: пока табло открыто, напоминание будет сдвигаться вместе с ним.' : ''),
      [
        { text: 'За 2 мин', onPress: () => void remind(2) },
        { text: 'За 5 мин', onPress: () => void remind(5) },
        { text: 'За 10 мин', onPress: () => void remind(10) },
        { text: 'Отмена', style: 'cancel' },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: name ?? '',
          headerRight: () =>
            name ? (
              <Pressable
                onPress={() => toggleFavorite(name)}
                hitSlop={12}
                accessibilityLabel={isFavorite ? 'Убрать из избранного' : 'В избранное'}
              >
                <Text style={{ fontSize: 22, color: isFavorite ? theme.amber : theme.muted }}>{isFavorite ? '★' : '☆'}</Text>
              </Pressable>
            ) : null,
        }}
      />
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
        data={rows}
        keyExtractor={(item) => rowKey(item.departure)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: theme.border }]} />}
        ListEmptyComponent={
          loaded ? <Text style={[styles.empty, { color: theme.muted }]}>Ближайшие 3 часа отправлений нет</Text> : undefined
        }
        renderItem={({ item }) => {
          const { departure } = item;
          const soon = item.at - now < 15 * 60_000;
          const late = item.delaySeconds !== null && item.delaySeconds >= 120;
          return (
            <Pressable
              onPress={() => onRowPress(item)}
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.inputBackground : theme.surface }]}
            >
              <LineBadge line={departure.line} tram={departure.tram} />
              <View style={styles.middle}>
                <Text style={[styles.headsign, { color: theme.text }]} numberOfLines={1}>
                  {departure.headsign ?? '—'}
                </Text>
                <Text style={[styles.post, { color: theme.muted }]} numberOfLines={1}>
                  {[
                    posts.length > 1 && selectedPost === null ? `słupek ${departure.stopCode ?? ''}` : null,
                    item.isLive && item.at !== departure.at
                      ? `${formatClock(item.at)} (по расписанию ${formatClock(departure.at)})`
                      : formatClock(departure.at),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <View style={styles.right}>
                <View style={styles.timeRow}>
                  {reminderByKey.has(rowKey(departure)) ? <Text style={styles.bell}>🔔</Text> : null}
                  {item.isLive ? <View style={[styles.dot, { backgroundColor: '#16A34A' }]} /> : null}
                  <Text style={[styles.time, { color: soon ? theme.amber : theme.text }]}>{countdown(item.at, now)}</Text>
                </View>
                {item.delaySeconds !== null ? (
                  <Text style={[styles.delay, { color: late ? theme.danger : theme.muted }]}>{delayLabel(item.delaySeconds)}</Text>
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />
      <Text style={[styles.footnote, { color: theme.muted }]}>
        {liveCount
          ? `Онлайн: ${liveCount} рейсов отслеживаются · задержка по расписанию GTFS`
          : 'По расписанию GTFS · онлайн появится, когда рейс выйдет на линию'}
        {' · нажмите на рейс, чтобы напомнить'}
      </Text>
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
  right: { alignItems: 'flex-end', gap: 2 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  bell: { fontSize: 12 },
  time: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  delay: { fontSize: 12, fontWeight: '600' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 68 },
  empty: { textAlign: 'center', marginTop: 32, fontSize: 15 },
  footnote: { textAlign: 'center', fontSize: 12, paddingVertical: 8 },
});
