import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import { cancelReminder, scheduleReminder, type ReminderRequest } from '../platform/notifications';

const KEY = 'reminders';

export type Reminder = ReminderRequest & {
  /** The departure row it belongs to: trip, service day and post. */
  key: string;
  /** The scheduled notification's id. */
  id: string;
  fireAt: number;
};

const read = (): Reminder[] => {
  try {
    const raw = Storage.getItemSync(KEY);
    const all = raw ? (JSON.parse(raw) as Reminder[]) : [];
    // Departures already gone need no reminder any more.
    return all.filter((reminder) => reminder.departAt > Date.now() - 60_000);
  } catch {
    return [];
  }
};

const write = (items: Reminder[]) => {
  try {
    Storage.setItemSync(KEY, JSON.stringify(items));
  } catch {
    // Lost on restart; the notifications themselves stay scheduled.
  }
};

type RemindersState = {
  items: Reminder[];
  add: (key: string, request: ReminderRequest) => Promise<Reminder>;
  remove: (key: string) => Promise<void>;
  /** Move a reminder when its departure's live estimate changed. */
  reschedule: (key: string, departAt: number) => Promise<void>;
};

export const useReminders = create<RemindersState>((set, get) => ({
  items: read(),
  add: async (key, request) => {
    await get().remove(key);
    const { id, fireAt } = await scheduleReminder(request);
    const reminder: Reminder = { ...request, key, id, fireAt };
    const items = [...get().items, reminder];
    set({ items });
    write(items);
    return reminder;
  },
  remove: async (key) => {
    const existing = get().items.find((reminder) => reminder.key === key);
    if (!existing) return;
    await cancelReminder(existing.id);
    const items = get().items.filter((reminder) => reminder.key !== key);
    set({ items });
    write(items);
  },
  reschedule: async (key, departAt) => {
    const existing = get().items.find((reminder) => reminder.key === key);
    // Already fired, or nothing to move.
    if (!existing || existing.fireAt <= Date.now()) return;
    await get().add(key, {
      stop: existing.stop,
      line: existing.line,
      headsign: existing.headsign,
      minutesBefore: existing.minutesBefore,
      departAt,
    });
  },
}));
