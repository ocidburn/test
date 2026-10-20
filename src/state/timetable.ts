import { create } from 'zustand';

import type { Db } from '../core/db';
import type { TimetableMeta } from '../core/gtfs/queries';
import { dropDatabase, needsCheck, openInstalled, updateTimetable, type UpdateProgress } from '../platform/timetable';

type Status = 'starting' | 'empty' | 'ready';

type TimetableState = {
  status: Status;
  db: Db | null;
  meta: TimetableMeta | null;
  /** Set while a check, download or import runs. */
  activity: UpdateProgress | null;
  lastError: string | null;
  lastResult: string | null;
  log: string[];
  init: () => Promise<void>;
  update: (options?: { force?: boolean }) => Promise<void>;
};

const PHASES: Record<string, string> = {
  routes: 'линии',
  stops: 'остановки',
  calendar: 'календарь',
  shapes: 'маршруты',
  trips: 'рейсы',
  stop_times: 'расписание',
  index: 'индексы',
  done: 'готово',
};

export const describeActivity = (activity: UpdateProgress | null): string | null => {
  if (!activity) return null;
  switch (activity.stage) {
    case 'checking':
      return 'Проверяю новое расписание…';
    case 'downloading':
      return activity.fraction === null
        ? 'Скачиваю расписание…'
        : `Скачиваю расписание… ${Math.round(activity.fraction * 100)}%`;
    case 'importing':
      return `Импорт: ${PHASES[activity.progress.phase] ?? activity.progress.phase} ${Math.round(activity.progress.fraction * 100)}%`;
  }
};

export const useTimetable = create<TimetableState>((set, get) => ({
  status: 'starting',
  db: null,
  meta: null,
  activity: null,
  lastError: null,
  lastResult: null,
  log: [],

  init: async () => {
    if (get().status !== 'starting') return;
    const opened = await openInstalled();
    set(opened ? { status: 'ready', db: opened.db, meta: opened.meta } : { status: 'empty' });
    void get().update();
  },

  update: async ({ force = false } = {}) => {
    // init() decides the first check; an app-foreground event racing it must not start a second one.
    if (get().activity || get().status === 'starting') return;
    if (!force && get().status === 'ready' && !needsCheck()) return;
    const log: string[] = [];
    set({ activity: { stage: 'checking' }, lastError: null });
    try {
      const result = await updateTimetable({
        onProgress: (activity) => set({ activity }),
        log: (message) => log.push(message),
      });
      if (result.updated) {
        const previous = get().db;
        set({ status: 'ready', db: result.opened.db, meta: result.opened.meta, lastResult: 'Расписание обновлено' });
        await previous?.close().catch(() => {});
        await dropDatabase(result.replaced);
      } else {
        set({ lastResult: result.reason });
      }
    } catch (error) {
      set({ lastError: (error as Error).message });
    } finally {
      set({ activity: null, log });
    }
  },
}));
