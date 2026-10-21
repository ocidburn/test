import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';

import { nearbyStops, searchStops, stopsByNames, type NearbyStop, type StopSearchResult } from '../core/gtfs/queries';
import { useFavorites } from '../state/favorites';
import { useTimetable } from '../state/timetable';
import { LineBadge } from '../ui/line-badge';
import { StatusBanner } from '../ui/status-banner';
import { useTheme } from '../ui/theme';

type Row = StopSearchResult & { distanceMeters?: number; favorite?: boolean };
type Section = { title: string | null; data: Row[] };

const formatDistance = (meters: number) => (meters < 1000 ? `${Math.round(meters / 10) * 10} м` : `${(meters / 1000).toFixed(1)} км`);

export default function StopSearchScreen() {
  const theme = useTheme();
  const db = useTimetable((state) => state.db);
  const status = useTimetable((state) => state.status);
  const favoriteNames = useFavorites((state) => state.stops);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StopSearchResult[]>([]);
  const [favorites, setFavorites] = useState<StopSearchResult[]>([]);
  const [nearby, setNearby] = useState<NearbyStop[]>([]);
  /** 'unknown' until checked; 'denied' shows a button that asks. */
  const [locationState, setLocationState] = useState<'unknown' | 'granted' | 'denied'>('unknown');

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

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    stopsByNames(db, favoriteNames)
      .then((rows) => !cancelled && setFavorites(rows))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [db, favoriteNames]);

  const loadNearby = useCallback(async () => {
    if (!db) return;
    // The last known fix answers at once; a fresh one refines it.
    const last = await Location.getLastKnownPositionAsync();
    if (last) setNearby(await nearbyStops(db, last.coords.latitude, last.coords.longitude));
    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setNearby(await nearbyStops(db, current.coords.latitude, current.coords.longitude));
  }, [db]);

  useEffect(() => {
    let cancelled = false;
    Location.getForegroundPermissionsAsync()
      .then(async (permission) => {
        if (cancelled) return;
        setLocationState(permission.granted ? 'granted' : 'denied');
        if (permission.granted) await loadNearby();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [loadNearby]);

  const askLocation = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    setLocationState(permission.granted ? 'granted' : 'denied');
    if (permission.granted) await loadNearby().catch(() => {});
  };

  const favoriteSet = new Set(favoriteNames);
  const sections: Section[] = query.trim()
    ? [{ title: null, data: results.map((row) => ({ ...row, favorite: favoriteSet.has(row.name) })) }]
    : [
        ...(favorites.length ? [{ title: 'Избранное', data: favorites.map((row) => ({ ...row, favorite: true })) }] : []),
        ...(nearby.length
          ? [{ title: 'Рядом', data: nearby.map((row) => ({ ...row, favorite: favoriteSet.has(row.name) })) }]
          : []),
      ];

  return (
    <View style={styles.screen}>
      <StatusBanner />
      <View style={styles.searchWrap}>
        <TextInput
          // With favourites to pick from, the keyboard would only cover them.
          autoFocus={favoriteNames.length === 0}
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
      <SectionList
        sections={sections}
        keyExtractor={(item, index) => `${item.name}-${index}`}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: theme.border }]} />}
        renderSectionHeader={({ section }) =>
          section.title ? <Text style={[styles.section, { color: theme.muted }]}>{section.title.toUpperCase()}</Text> : null
        }
        ListEmptyComponent={
          query.trim() && status === 'ready' ? (
            <Text style={[styles.empty, { color: theme.muted }]}>Ничего не нашлось</Text>
          ) : undefined
        }
        ListFooterComponent={
          !query.trim() && locationState === 'denied' ? (
            <Pressable onPress={askLocation} style={[styles.locate, { backgroundColor: theme.surface }]}>
              <Text style={{ color: theme.accent, fontSize: 16, fontWeight: '600' }}>Показать остановки рядом</Text>
              <Text style={{ color: theme.muted, fontSize: 13 }}>Нужен доступ к геопозиции, только пока приложение открыто</Text>
            </Pressable>
          ) : undefined
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/stop/[name]', params: { name: item.name } })}
            style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.inputBackground : theme.surface }]}
          >
            <View style={styles.titleRow}>
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                {item.favorite ? '★ ' : ''}
                {item.name}
              </Text>
              {item.distanceMeters !== undefined ? (
                <Text style={[styles.distance, { color: theme.muted }]}>{formatDistance(item.distanceMeters)}</Text>
              ) : null}
            </View>
            <View style={styles.lines}>
              {item.lines.slice(0, 14).map((line) => (
                <LineBadge key={line.name} line={line.name} tram={line.tram} size="small" />
              ))}
              {item.lines.length > 14 ? <Text style={{ color: theme.muted, fontSize: 12 }}>+{item.lines.length - 14}</Text> : null}
            </View>
          </Pressable>
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
  section: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
  row: { paddingHorizontal: 16, paddingVertical: 12, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  name: { fontSize: 17, fontWeight: '600', flex: 1 },
  distance: { fontSize: 13, fontVariant: ['tabular-nums'] },
  lines: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  empty: { textAlign: 'center', marginTop: 32, fontSize: 15 },
  locate: { marginHorizontal: 16, marginTop: 16, padding: 14, borderRadius: 12, gap: 4 },
});
