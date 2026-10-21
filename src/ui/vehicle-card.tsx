import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { delayStatus, type RunDescription, type UpcomingStop } from '../core/realtime/trip-match';
import type { LiveVehicle } from '../core/realtime/types';
import { formatClock } from '../core/time/warsaw';
import { LineBadge } from './line-badge';
import { Sheet } from './sheet';
import { ScheduleTime } from './schedule-time';
import { delayTextColor, lineColor, useTheme } from './theme';

const SOURCES: Record<LiveVehicle['source'], string> = {
  impk: 'iMPK',
  mpk: 'MPK',
  merged: 'MPK + Open Data',
  'open-data': 'Open Data',
  klosok: 'Kłosok',
};

const age = (positionAt: number, now: number) => {
  const seconds = Math.max(0, Math.round((now - positionAt) / 1000));
  return seconds < 60 ? `${seconds} с назад` : `${Math.round(seconds / 60)} мин назад`;
};

const delayText = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  if (minutes === 0) return 'по расписанию';
  return minutes > 0 ? `опаздывает на ${minutes} мин` : `раньше на ${-minutes} мин`;
};

const stopsWord = (n: number) => {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return `${n} остановок`;
  if (ones === 1) return `${n} остановка`;
  if (ones >= 2 && ones <= 4) return `${n} остановки`;
  return `${n} остановок`;
};

/** Minutes to go; past an hour, the clock time it is expected. */
function Eta({ seconds, now, big, color }: { seconds: number; now: number; big?: boolean; color: string }) {
  const size = big ? 40 : 22;
  if (seconds < 60) return <Text style={{ color, fontSize: big ? 34 : 20, fontWeight: '700' }}>сейчас</Text>;
  if (seconds >= 3600) return <Text style={{ color, fontSize: size * 0.8, fontWeight: '700' }}>{formatClock(now + seconds * 1000)}</Text>;
  return (
    <Text style={{ color, fontSize: size, fontWeight: '700' }}>
      {Math.round(seconds / 60)}
      <Text style={{ fontSize: big ? 20 : 15, fontWeight: '500' }}> мин</Text>
    </Text>
  );
}

/** A stop ahead: by the matched run, with its time; or by the route alone, without one. */
type Ahead = { key: string; name: string; stop: UpcomingStop | null };

/**
 * The selected vehicle: half the screen with where it is and its next stop,
 * dragged up to the whole route ahead with scheduled times and countdowns.
 */
export function VehicleSheet({
  vehicle,
  headsign,
  where,
  run,
  routeStops,
  delaySeconds,
  now,
  following,
  half,
  full,
  onToggleFollow,
  onClose,
  onStop,
}: {
  vehicle: LiveVehicle;
  /** From the feed, or from the route variant the vehicle was matched to. */
  headsign: string | null;
  /** "на остановке X" / "проехал X", from the route; null before the route is known. */
  where: string | null;
  /** The scheduled run the vehicle is on, with every stop still ahead; null when none matches. */
  run: RunDescription | null;
  /** Stops ahead by the route geometry, used when no run matches. */
  routeStops: { stopIdx: number; name: string }[];
  /** The feed's delay, or the one worked out from the schedule. Null when unknown. */
  delaySeconds: number | null;
  now: number;
  /** The map keeps this vehicle in the middle. */
  following: boolean;
  half: number;
  full: number;
  onToggleFollow: () => void;
  onClose: () => void;
  onStop: (name: string) => void;
}) {
  const theme = useTheme();
  const color = lineColor(vehicle.line, vehicle.tram);
  const ahead: Ahead[] = run?.nextStops.length
    ? run.nextStops.map((stop, i) => ({ key: `${i}-${stop.stopIdx}`, name: stop.name, stop }))
    : routeStops.map((stop, i) => ({ key: `${i}-${stop.stopIdx}`, name: stop.name, stop: null }));
  const next = ahead[0] ?? null;
  const remaining = run ? run.stopsAhead : ahead.length;
  const details = [
    vehicle.vehicleNumber ? `№ ${vehicle.vehicleNumber}` : null,
    vehicle.brigade ? `бриг. ${vehicle.brigade}` : null,
    // Where the delay came from: the feed states it, or it was inferred from the timetable.
    vehicle.delaySeconds !== null ? SOURCES[vehicle.source] : delaySeconds !== null ? `${SOURCES[vehicle.source]} + расписание` : SOURCES[vehicle.source],
    age(vehicle.positionAt, now),
  ].filter(Boolean);

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <LineBadge line={vehicle.line} tram={vehicle.tram} />
        <View style={styles.middle}>
          <Text style={[styles.headsign, { color: theme.text }]} numberOfLines={1}>
            {headsign ?? 'Направление не определено'}
          </Text>
          <Text style={[styles.sub, { color: theme.muted }]} numberOfLines={1}>
            {where ?? details.join(' · ')}
          </Text>
        </View>
        <Pressable
          onPress={onToggleFollow}
          hitSlop={8}
          accessibilityLabel={following ? 'Не следить' : 'Следить'}
          accessibilityState={{ selected: following }}
          style={[styles.follow, { borderColor: theme.accent, backgroundColor: following ? theme.accent : 'transparent' }]}
        >
          <Text style={{ color: following ? '#FFFFFF' : theme.accent, fontSize: 13, fontWeight: '600' }}>◎</Text>
        </Pressable>
        <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Закрыть" style={[styles.close, { backgroundColor: theme.inputBackground }]}>
          <Text style={{ color: theme.muted, fontSize: 16, fontWeight: '700' }}>✕</Text>
        </Pressable>
      </View>
      {next ? (
        <View style={[styles.summary, { backgroundColor: theme.inputBackground }]}>
          <View style={styles.middle}>
            <Text style={[styles.caption, { color: theme.muted }]}>СЛЕДУЮЩАЯ ОСТАНОВКА</Text>
            <Text style={[styles.nextName, { color: theme.text }]} numberOfLines={1}>
              {next.name}
            </Text>
            <Text style={[styles.sub, { color: theme.muted }]} numberOfLines={1}>
              <Text style={delaySeconds !== null ? { color: delayTextColor(theme, delayStatus(delaySeconds)), fontWeight: '600' } : null}>
                {delaySeconds !== null ? delayText(delaySeconds) : 'рейс не определён'}
              </Text>
              {remaining ? ` · ${stopsWord(remaining)}` : ''}
            </Text>
          </View>
          {next.stop ? <Eta seconds={next.stop.etaSeconds} now={now} big color={theme.amber} /> : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <Sheet key={vehicle.id} half={half} full={full} onDismiss={onClose} header={header}>
      {(expanded) => (
        <ScrollView scrollEnabled={expanded} contentContainerStyle={styles.list} showsVerticalScrollIndicator={expanded}>
          {ahead.length ? (
            <View style={[styles.timeline, { backgroundColor: theme.inputBackground }]}>
              {ahead.map((item, i) => (
                <Pressable key={item.key} onPress={() => onStop(item.name)} style={styles.stopRow}>
                  <View style={styles.rail}>
                    <View style={[styles.railLine, { backgroundColor: color, top: i === 0 ? '50%' : 0, bottom: i === ahead.length - 1 ? '50%' : 0 }]} />
                    <View
                      style={[
                        styles.node,
                        i === 0 ? { backgroundColor: color, borderColor: color } : { backgroundColor: theme.inputBackground, borderColor: color },
                      ]}
                    />
                  </View>
                  <View style={styles.middle}>
                    <Text style={[styles.stopName, { color: theme.text, fontWeight: i === 0 ? '700' : '500' }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {item.stop?.scheduledAt ? (
                      <ScheduleTime
                        scheduledAt={item.stop.scheduledAt}
                        expectedAt={delaySeconds !== null ? item.stop.scheduledAt + delaySeconds * 1000 : null}
                        delaySeconds={delaySeconds}
                        prefix="по расписанию"
                        style={styles.sub}
                      />
                    ) : null}
                  </View>
                  {item.stop ? <Eta seconds={item.stop.etaSeconds} now={now} color={theme.amber} /> : null}
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={[styles.sub, { color: theme.muted, padding: 4 }]}>
              {where === null ? 'Маршрут определяется…' : 'Дальше остановок нет: конечная.'}
            </Text>
          )}
          {!run && ahead.length ? (
            <Text style={[styles.sub, { color: theme.muted }]}>
              Рейс по расписанию не найден — остановки по маршруту, без времени: опоздание не угадывается.
            </Text>
          ) : null}
          <Text style={[styles.sub, { color: theme.muted }]}>{details.join(' · ')}</Text>
        </ScrollView>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  middle: { flex: 1, gap: 2 },
  headsign: { fontSize: 20, fontWeight: '700' },
  sub: { fontSize: 13 },
  caption: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  nextName: { fontSize: 19, fontWeight: '700' },
  follow: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 14 },
  list: { paddingHorizontal: 16, paddingBottom: 40, gap: 12 },
  timeline: { borderRadius: 14, paddingVertical: 6, paddingRight: 14 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56 },
  rail: { width: 36, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  railLine: { position: 'absolute', width: 4, borderRadius: 2 },
  node: { width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
  stopName: { fontSize: 16 },
});
