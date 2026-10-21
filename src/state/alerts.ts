import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import { fetchMpkNotices, fetchNoticeText, sortNotices, type Notice } from '../core/alerts/mpk-notices';
import { warsawDateKey } from '../core/time/warsaw';

const KEY = 'alerts.notices';
const SEEN_KEY = 'alerts.seen';
/** Notices change a few times a week; half an hour is plenty. */
const REFRESH_MS = 30 * 60_000;
/** After a failure, try again sooner. */
const RETRY_MS = 5 * 60_000;

type Saved = { notices: Notice[]; at: number | null };

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = Storage.getItemSync(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: unknown) => {
  try {
    Storage.setItemSync(key, JSON.stringify(value));
  } catch {
    // Kept for this session only.
  }
};

type AlertsState = {
  /** As last read from MPK; the last good list is kept through a failure and across launches. */
  notices: Notice[];
  at: number | null;
  error: string | null;
  loading: boolean;
  triedAt: number | null;
  /** Ids already looked at: the "!" counts the others. */
  seen: string[];
  /** Full texts, read when a notice is opened. */
  texts: Record<string, { text: string | null; error: string | null }>;
  refresh: (force?: boolean) => Promise<void>;
  markSeen: () => void;
  loadText: (notice: Notice) => Promise<void>;
};

const saved = read<Saved>(KEY, { notices: [], at: null });

export const useAlerts = create<AlertsState>((set, get) => ({
  notices: saved.notices,
  at: saved.at,
  error: null,
  loading: false,
  triedAt: null,
  seen: read<string[]>(SEEN_KEY, []),
  texts: {},
  refresh: async (force = false) => {
    const { loading, at, triedAt, error } = get();
    const now = Date.now();
    if (loading) return;
    if (!force && at !== null && now - at < REFRESH_MS) return;
    if (!force && error && triedAt !== null && now - triedAt < RETRY_MS) return;
    set({ loading: true, triedAt: now });
    try {
      const notices = await fetchMpkNotices({ timeoutMs: 20_000 });
      set({ notices, at: Date.now(), error: null, loading: false });
      write(KEY, { notices, at: Date.now() } satisfies Saved);
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },
  markSeen: () => {
    const ids = get().notices.map((n) => n.id);
    const seen = [...new Set([...get().seen.filter((id) => ids.includes(id)), ...ids])];
    set({ seen });
    write(SEEN_KEY, seen);
  },
  loadText: async (notice) => {
    const kept = get().texts[notice.id];
    if (kept?.text) return;
    set({ texts: { ...get().texts, [notice.id]: { text: null, error: null } } });
    try {
      const text = await fetchNoticeText(notice.url, { timeoutMs: 20_000 });
      set({ texts: { ...get().texts, [notice.id]: { text, error: null } } });
    } catch (e) {
      set({ texts: { ...get().texts, [notice.id]: { text: null, error: (e as Error).message } } });
    }
  },
}));

/** Notices in force today or coming, in display order. */
export const currentNotices = (notices: Notice[], now = Date.now()) => sortNotices(notices, warsawDateKey(now));
