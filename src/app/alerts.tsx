import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { noticeState, type Notice } from '../core/alerts/mpk-notices';
import { formatClock, splitDateKey, warsawDateKey } from '../core/time/warsaw';
import { lineVisibility } from '../core/line-groups';
import { currentNotices, useAlerts } from '../state/alerts';
import { useFavorites } from '../state/favorites';
import { useLive } from '../state/live';
import { LineBadge } from '../ui/line-badge';
import { useTheme } from '../ui/theme';
import { useNow } from '../ui/use-now';

const ALERT_MPK = 'https://x.com/AlertMPK';

const shortDate = (key: number) => {
  const { month, day } = splitDateKey(key);
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}`;
};

const stamp = (at: number, today: number) =>
  warsawDateKey(at) === today ? formatClock(at) : `${shortDate(warsawDateKey(at))} ${formatClock(at)}`;

const validity = (notice: Notice, today: number) => {
  if (noticeState(notice, today) === 'soon' && notice.from !== null) {
    return notice.to !== null ? `с ${shortDate(notice.from)} по ${shortDate(notice.to)}` : `с ${shortDate(notice.from)}`;
  }
  return notice.to !== null ? `действует до ${shortDate(notice.to)}` : 'действует';
};

/** MPK's planned service changes: diversions, roadworks, moved stops. */
export default function AlertsScreen() {
  const theme = useTheme();
  const notices = useAlerts((state) => state.notices);
  const at = useAlerts((state) => state.at);
  const error = useAlerts((state) => state.error);
  const loading = useAlerts((state) => state.loading);
  // What was new when the list opened keeps its dot while the list is open.
  const [seenAtOpen] = useState(() => new Set(useAlerts.getState().seen));
  const refresh = useAlerts((state) => state.refresh);
  const markSeen = useAlerts((state) => state.markSeen);
  const hidden = useLive((state) => state.hidden);
  const lines = useLive((state) => state.lines);
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => markSeen(), [notices, markSeen]);

  const nowMs = useNow(60_000);
  const today = warsawDateKey(nowMs);
  const trams = useMemo(() => new Set(lines.filter((l) => l.tram).map((l) => l.name)), [lines]);
  const isTram = (line: string) => (trams.size ? trams.has(line) : /^\d{1,2}$/.test(line));
  // With some lines hidden, "my lines" are the ones the map shows.
  const filterSet = useMemo(
    () => (hidden.length ? new Set(lineVisibility(lines, hidden).shownLines) : new Set<string>()),
    [lines, hidden],
  );
  const shown = useMemo(() => {
    const list = currentNotices(notices, nowMs);
    return mine && filterSet.size ? list.filter((n) => n.lines.some((line) => filterSet.has(line))) : list;
  }, [notices, mine, filterSet, nowMs]);
  const now = shown.filter((n) => noticeState(n, today) === 'now');
  const soon = shown.filter((n) => noticeState(n, today) === 'soon');

  const section = (title: string, list: Notice[]) =>
    list.length ? (
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
        {list.map((notice) => (
          <NoticeRow
            key={notice.id}
            notice={notice}
            today={today}
            fresh={!seenAtOpen.has(notice.id)}
            open={open === notice.id}
            onToggle={() => setOpen(open === notice.id ? null : notice.id)}
            isTram={isTram}
            highlight={filterSet}
          />
        ))}
      </View>
    ) : null;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh(true)} />}
    >
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        <Text style={{ color: theme.muted, fontSize: 13 }}>
          Плановые изменения MPK с mpk.wroc.pl: объезды, ремонты, перенос остановок. О внезапных сбоях (авария,
          затор, вагон сошёл с рельсов) MPK пишет в X — их приложение без сервера прочитать не может.
        </Text>
        <Pressable onPress={() => void Linking.openURL(ALERT_MPK)} hitSlop={8}>
          <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '600' }}>Открыть @AlertMPK в X</Text>
        </Pressable>
      </View>
      {filterSet.size ? (
        <View style={styles.tabs}>
          {[
            { on: !mine, label: 'Все', press: () => setMine(false) },
            { on: mine, label: `Линии на карте · ${filterSet.size}`, press: () => setMine(true) },
          ].map((tab) => (
            <Pressable
              key={tab.label}
              onPress={tab.press}
              style={[styles.tab, { borderColor: theme.accent, backgroundColor: tab.on ? theme.accent : 'transparent' }]}
            >
              <Text style={{ color: tab.on ? '#FFFFFF' : theme.accent, fontWeight: '600', fontSize: 13 }}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {error ? (
        <Text style={{ color: theme.danger, fontSize: 13 }}>
          Не удалось обновить: {error}
          {at ? ` Показан список от ${stamp(at, today)}.` : ''}
        </Text>
      ) : null}
      {!at && loading ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
      {at && !shown.length ? (
        <Text style={{ color: theme.muted, padding: 8 }}>
          {mine ? 'Для выбранных линий изменений нет.' : 'Сейчас изменений нет.'}
        </Text>
      ) : null}
      {section('Действуют сейчас', now)}
      {section('Скоро', soon)}
      {at ? <Text style={{ color: theme.muted, fontSize: 12 }}>Обновлено: {stamp(at, today)}. Потяните вниз, чтобы обновить.</Text> : null}
    </ScrollView>
  );
}

function NoticeRow({
  notice,
  today,
  fresh,
  open,
  onToggle,
  isTram,
  highlight,
}: {
  notice: Notice;
  today: number;
  fresh: boolean;
  open: boolean;
  onToggle: () => void;
  isTram: (line: string) => boolean;
  highlight: Set<string>;
}) {
  const theme = useTheme();
  const text = useAlerts((state) => state.texts[notice.id]);
  const loadText = useAlerts((state) => state.loadText);
  const favorites = useFavorites((state) => state.stops);
  // A title starting with the start date repeats what the line above says.
  const title = (notice.from !== null && notice.title.replace(/^\s*\d{1,2}\.\d{1,2}\.\d{4}\s*r?\.?\s*[-–]\s*/i, '')) || notice.title;
  const touchesFavorite = favorites.some((stop) => stop.length >= 4 && notice.title.toLowerCase().includes(stop.toLowerCase()));

  return (
    <Pressable
      onPress={() => {
        if (!open) void loadText(notice);
        onToggle();
      }}
      style={[styles.card, { backgroundColor: theme.surface }]}
    >
      <View style={styles.meta}>
        {fresh ? <View style={[styles.fresh, { backgroundColor: theme.danger }]} /> : null}
        <Text style={{ color: noticeState(notice, today) === 'soon' ? theme.amber : theme.muted, fontSize: 13, flex: 1 }}>
          {validity(notice, today)}
          {touchesFavorite ? ' · ★ ваша остановка' : ''}
        </Text>
        <Text style={{ color: theme.muted, fontSize: 13 }}>{open ? '▴' : '▾'}</Text>
      </View>
      <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{title}</Text>
      {notice.lines.length ? (
        <View style={styles.badges}>
          {notice.lines.map((line) => (
            <View key={line} style={highlight.size && !highlight.has(line) ? { opacity: 0.45 } : null}>
              <LineBadge line={line} tram={isTram(line)} size="small" />
            </View>
          ))}
        </View>
      ) : null}
      {open ? (
        <View style={styles.body}>
          {text?.text ? (
            <Text style={{ color: theme.text, fontSize: 15, lineHeight: 21 }} selectable>
              {text.text}
            </Text>
          ) : text?.error ? (
            <Text style={{ color: theme.danger, fontSize: 13 }}>Текст не загрузился: {text.error}</Text>
          ) : (
            <ActivityIndicator />
          )}
          <Pressable onPress={() => void Linking.openURL(notice.url)} hitSlop={8}>
            <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '600' }}>На сайте MPK (схемы, PDF)</Text>
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 16 },
  card: { borderRadius: 12, padding: 12, gap: 8 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fresh: { width: 8, height: 8, borderRadius: 4 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  body: { gap: 12, paddingTop: 4 },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
});
