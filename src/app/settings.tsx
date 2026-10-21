import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatDateKey } from '../core/time/warsaw';
import { lastCheckedAt } from '../platform/timetable';
import type { SourceDetail } from '../core/realtime/types';
import { useLive } from '../state/live';
import { useTimetable } from '../state/timetable';
import { ImpkSettings } from '../ui/impk-settings';
import { StatusBanner } from '../ui/status-banner';
import { useTheme } from '../ui/theme';
import { useNow } from '../ui/use-now';

const formatInstant = (ms: number | null | undefined) => {
  if (!ms) return '—';
  const date = new Date(ms);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString().slice(0, 5)}`;
};

/** The portal hands out bare file ids; `…/hdb/download/119/` is file 119. */
const snapshotFromUrl = (url: string | null) => {
  if (!url) return '—';
  const id = /\/(\d+)\/?$/.exec(url)?.[1];
  return id ? `файл ${id} портала` : url.replace(/^https?:\/\//, '');
};

const LIVE_SOURCES = [
  ['mpk', 'MPK bus_position'],
  ['openData', 'Open Data (таблица 14)'],
  ['klosok', 'Kłosok GTFS-RT'],
] as const;

const REJECTED: Record<string, string> = {
  line: 'без линии',
  number: 'без номера',
  position: 'без координат',
  time: 'время не читается',
  stale: 'устарели',
  future: 'время в будущем',
};

const formatAge = (seconds: number) =>
  Math.abs(seconds) < 120 ? `${seconds} с` : Math.abs(seconds) < 7200 ? `${Math.round(seconds / 60)} мин` : `${Math.round(seconds / 3600)} ч`;

/** "из 512 строк: 498 устарели · время как UTC, медиана 2 ч" */
const formatDetail = (detail: SourceDetail) => {
  const rejected = Object.entries(detail.rejected)
    .filter(([, count]) => count)
    .map(([reason, count]) => `${count} ${REJECTED[reason] ?? reason}`);
  const parts = [`из ${detail.total} строк${rejected.length ? `: отброшено ${rejected.join(', ')}` : ''}`];
  if (detail.medianAgeSeconds !== undefined && detail.medianAgeSeconds !== null) {
    parts.push(`время ${detail.clock === 'utc' ? 'как UTC' : 'варшавское'}, медиана возраста ${formatAge(detail.medianAgeSeconds)}`);
  }
  return parts.join(' · ');
};

/** Source errors in plain Russian; anything unrecognised is shown as is. */
const humanError = (message: string) =>
  message
    .replace(/empty body \(HTTP (\d+)\)/g, 'пустой ответ сервера (HTTP $1)')
    .replace(/not JSON \(HTTP (\d+)\)/g, 'ответ не JSON (HTTP $1)')
    .replace(/timed out after (\d+) ms: \S+/g, 'нет ответа за $1 мс')
    .replace(/\bempty list\b/g, 'пустой список')
    .replace(/Network request failed/g, 'нет сети');

const retryIn = (retryAt: number | null, now: number) => {
  if (!retryAt) return '';
  const seconds = Math.max(0, Math.round((retryAt - now) / 1000));
  // The pause is over; the source is asked again on the map's next poll.
  if (seconds === 0) return ' · повтор при следующем опросе';
  return seconds < 90 ? ` · повтор через ${seconds} с` : ` · повтор через ${Math.round(seconds / 60)} мин`;
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
  const live = useLive((state) => state.status);
  const now = useNow(5_000);

  const rows: [string, string][] = [
    ['Снимок', meta?.sourceName ?? snapshotFromUrl(meta?.sourceUrl ?? null)],
    ['Действует', meta?.feedStart && meta?.feedEnd ? `${formatDateKey(meta.feedStart)} — ${formatDateKey(meta.feedEnd)}` : '—'],
    ['Импортировано', formatInstant(meta?.importedAt ?? null)],
    ['Проверено', formatInstant(lastCheckedAt())],
    ['Линий', String(meta?.counts?.routes ?? '—')],
    ['Остановок (słupki)', String(meta?.counts?.stops ?? '—')],
    ['Рейсов', String(meta?.counts?.trips ?? '—')],
    ['Строк расписания', String(meta?.counts?.stopTimes ?? '—')],
  ];

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
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
      <Text style={[styles.section, { color: theme.muted }]}>ЖИВЫЕ ДАННЫЕ</Text>
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        {LIVE_SOURCES.map(([key, label]) => {
          const source = live?.[key];
          const value = !source?.at
            ? 'ещё не опрашивался'
            : source.ok
              ? `${source.count} · ${formatInstant(source.okAt)}`
              : `ошибка: ${humanError(source.error ?? '?')}${retryIn(source.retryAt, now)}`;
          return (
            <View key={key} style={[styles.liveRow, { borderColor: theme.border }]}>
              <View style={styles.liveLine}>
                <Text style={{ color: theme.muted, fontSize: 15 }}>{label}</Text>
                <Text
                  style={{ color: source && !source.ok && source.at ? theme.danger : theme.text, fontSize: 14, flexShrink: 1, textAlign: 'right' }}
                  selectable
                  numberOfLines={3}
                >
                  {value}
                </Text>
              </View>
              {source?.ok && source.detail ? (
                <Text style={{ color: theme.muted, fontSize: 12 }} selectable>
                  {formatDetail(source.detail)}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
      <Text style={[styles.section, { color: theme.muted }]}>IMPK</Text>
      <ImpkSettings />
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
        Данные: Otwarte Dane Wrocław (GTFS и таблица положений), MPK Wrocław, PT Kłosok. Своего сервера нет: расписание хранится на телефоне, положения машин телефон запрашивает сам раз в 10 секунд, пока карта открыта.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 40, gap: 12 },
  section: { marginHorizontal: 20, marginTop: 8, fontSize: 12, fontWeight: '600' },
  card: { marginHorizontal: 16, borderRadius: 12, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  liveRow: { paddingHorizontal: 14, paddingVertical: 11, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  liveLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  button: { marginHorizontal: 16, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  note: { marginHorizontal: 20, fontSize: 13 },
});
