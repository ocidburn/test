import * as Notifications from 'expo-notifications';

import { formatClock } from '../core/time/warsaw';

/**
 * Local notifications only. The arrival reminder is scheduled on the phone,
 * so no push entitlement (which a free Apple ID cannot sign) is needed —
 * which is also why expo-notifications' config plugin is not in app.json.
 */

let handlerSet = false;

/** Show reminders as banners even while the app is open. */
export const setupNotifications = () => {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
};

/** A reminder this soon or sooner fires a few seconds from now instead. */
const MIN_LEAD_MS = 5_000;

export type ReminderRequest = {
  stop: string;
  line: string;
  headsign: string | null;
  departAt: number;
  minutesBefore: number;
};

/** Schedule a reminder; returns its id, or throws if notifications are not allowed. */
export const scheduleReminder = async ({ stop, line, headsign, departAt, minutesBefore }: ReminderRequest) => {
  const permission = await Notifications.getPermissionsAsync();
  const granted = permission.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) throw new Error('Уведомления запрещены в настройках iPhone для этого приложения');

  const now = Date.now();
  const fireAt = Math.max(departAt - minutesBefore * 60_000, now + MIN_LEAD_MS);
  const minutesLeft = Math.max(0, Math.round((departAt - fireAt) / 60_000));
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: `${line}${headsign ? ` → ${headsign}` : ''}`,
      body:
        minutesLeft > 0
          ? `Через ${minutesLeft} мин с остановки «${stop}», в ${formatClock(departAt)}`
          : `Отправляется с остановки «${stop}» в ${formatClock(departAt)}`,
      sound: true,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(fireAt) },
  });
  return { id, fireAt };
};

export const cancelReminder = (id: string) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
