import { StyleSheet, Text, type TextStyle } from 'react-native';

import { delayStatus } from '../core/realtime/trip-match';
import { formatClock } from '../core/time/warsaw';
import { delayTextColor, useTheme } from './theme';

/**
 * A scheduled time and, when the run is off it, the expected one beside it:
 * "~~19:52~~ 19:56". The timetable stays readable instead of being silently
 * overwritten; the expected time takes the delay's colour.
 */
export function ScheduleTime({
  scheduledAt,
  expectedAt,
  delaySeconds,
  prefix,
  style,
}: {
  scheduledAt: number;
  /** Null when no live estimate is known. */
  expectedAt: number | null;
  delaySeconds: number | null;
  /** Shown before the time when there is only the scheduled one ("по расписанию"). */
  prefix?: string;
  style?: TextStyle;
}) {
  const theme = useTheme();
  const scheduled = formatClock(scheduledAt);
  const expected = expectedAt !== null ? formatClock(expectedAt) : null;
  if (expectedAt === null || expected === scheduled) {
    return <Text style={[style, { color: theme.muted }]}>{prefix ? `${prefix} ${scheduled}` : scheduled}</Text>;
  }
  return (
    <Text style={[style, { color: theme.muted }]} accessibilityLabel={`по расписанию ${scheduled}, ожидается ${expected}`}>
      <Text style={styles.struck}>{scheduled}</Text>
      {'  '}
      <Text style={[styles.expected, { color: delayTextColor(theme, delayStatus(delaySeconds ?? (expectedAt - scheduledAt) / 1000)) }]}>
        {expected}
      </Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  struck: { textDecorationLine: 'line-through' },
  expected: { fontWeight: '700' },
});
