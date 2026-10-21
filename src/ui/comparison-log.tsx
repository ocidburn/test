import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { describeComparison, describeUnmatched, type ComparisonEntry } from '../core/realtime/compare';
import { warsawParts } from '../core/time/warsaw';
import { useLive } from '../state/live';
import { useTheme } from './theme';

const SHOWN = 8;

/** HH:MM:SS in Wrocław: polls are 10 s apart. */
const clock = (ms: number) => {
  const { hour, minute, second } = warsawParts(ms);
  return [hour, minute, second].map((n) => String(n).padStart(2, '0')).join(':');
};

const entryLine = (entry: ComparisonEntry) =>
  [
    `${clock(entry.at)} iMPK ${entry.counts.impk}`,
    describeComparison('MPK', entry.mpk, entry.counts.mpk),
    ...describeUnmatched('MPK', entry.mpk).map((line) => `  ${line}`),
    describeComparison('Open Data', entry.openData, entry.counts.openData),
    ...describeUnmatched('Open Data', entry.openData).map((line) => `  ${line}`),
  ].join('\n  ');

/**
 * MPK and Open Data against iMPK, while iMPK runs: the latest comparison,
 * the last few, and the whole log (up to an hour, kept while the app runs)
 * to share.
 */
export function ComparisonLog() {
  const theme = useTheme();
  const entries = useLive((state) => state.comparisons);
  if (!entries.length) return null;
  const latest = entries[entries.length - 1];

  const share = () =>
    void Share.share({
      message: `Сравнение источников с iMPK, ${entries.length} опросов\n\n${entries.map(entryLine).join('\n')}`,
    }).catch(() => {});

  return (
    <>
      <Text style={[styles.section, { color: theme.muted }]}>СРАВНЕНИЕ С IMPK</Text>
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        <Text style={{ color: theme.text, fontSize: 13 }} selectable>
          {describeComparison('MPK', latest.mpk, latest.counts.mpk)}
        </Text>
        <Text style={{ color: theme.text, fontSize: 13 }} selectable>
          {describeComparison('Open Data', latest.openData, latest.counts.openData)}
        </Text>
        {[...describeUnmatched('MPK', latest.mpk), ...describeUnmatched('Open Data', latest.openData)].map((line) => (
          <Text key={line} style={{ color: theme.muted, fontSize: 12 }} selectable>
            {line}
          </Text>
        ))}
        <Text style={{ color: theme.muted, fontSize: 12 }}>
          MPK сопоставляется с iMPK по линии и расстоянию (до 400 м), Open Data — по бортовому номеру. Карта показывает iMPK; MPK
          опрашивается раз в минуту, Open Data — только когда iMPK и MPK молчат. Сравнивается только новый ответ.
        </Text>
        <View style={[styles.log, { borderColor: theme.border }]}>
          {entries
            .slice(-SHOWN)
            .reverse()
            .map((entry) => (
              <Text key={entry.at} style={{ color: theme.muted, fontSize: 11 }} selectable>
                {clock(entry.at)} · iMPK {entry.counts.impk} · MPK {entry.counts.mpk ?? '—'} (общих {entry.mpk?.matched ?? '—'}, медиана{' '}
                {entry.mpk?.medianMeters ?? '—'} м) · OD {entry.counts.openData ?? '—'} (общих {entry.openData?.matched ?? '—'})
              </Text>
            ))}
        </View>
        <Pressable
          onPress={share}
          style={({ pressed }) => [styles.button, { borderColor: theme.accent, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={{ color: theme.accent, fontWeight: '600' }}>Поделиться логом · {entries.length}</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  section: { marginHorizontal: 20, marginTop: 8, fontSize: 12, fontWeight: '600' },
  card: { marginHorizontal: 16, borderRadius: 12, padding: 12, gap: 8 },
  log: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 3 },
  button: { height: 40, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
