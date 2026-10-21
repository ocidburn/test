import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import type { Db } from '../core/db';
import { getLines, getStopNamesByCode, lineSets, timetableResolver, type LineInfo } from '../core/gtfs/map-queries';
import { isTramLine } from '../core/lines';
import { LiveTracker, type SourceName } from '../core/realtime/tracker';
import type { ComparisonEntry } from '../core/realtime/compare';
import type { LiveVehicle, SourceStatus } from '../core/realtime/types';
import { clearDescribeCache, routeHeading } from '../platform/describe';
import { impkClient } from './impk';
import { useTimetable } from './timetable';

const POLL_MS = 10_000;
/** Before hidden lines: the lines shown, empty meaning all. Read once, to carry a choice over. */
const OLD_FILTER_KEY = 'live.lineFilter';
const HIDDEN_KEY = 'live.hiddenLines';
const DELAYS_KEY = 'live.showDelays';

const readList = (key: string): string[] | null => {
  try {
    const raw = Storage.getItemSync(key);
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
};

const savedHidden = readList(HIDDEN_KEY);
/** An old "only these lines" choice, turned into hidden lines once the line list is known. */
const oldFilter = savedHidden === null ? (readList(OLD_FILTER_KEY) ?? []) : [];

const readDelays = (): boolean => {
  try {
    return Storage.getItemSync(DELAYS_KEY) === '1';
  } catch {
    return false;
  }
};

type LiveState = {
  vehicles: LiveVehicle[];
  at: number | null;
  status: Record<SourceName, SourceStatus> | null;
  /** MPK and Open Data against iMPK, one entry per iMPK answer, oldest first. */
  comparisons: ComparisonEntry[];
  lines: LineInfo[];
  /** Lines not shown on the map; a group with all its lines hidden is hidden whole. */
  hidden: string[];
  polling: boolean;
  /** The delay layer: markers ringed by how late their run is. */
  showDelays: boolean;
  setShowDelays: (on: boolean) => void;
  toggleLine: (line: string) => void;
  setHidden: (lines: string[]) => void;
};

export const useLive = create<LiveState>((set, get) => ({
  vehicles: [],
  at: null,
  status: null,
  comparisons: [],
  lines: [],
  hidden: savedHidden ?? [],
  polling: false,
  showDelays: readDelays(),
  setShowDelays: (showDelays) => {
    set({ showDelays });
    try {
      Storage.setItemSync(DELAYS_KEY, showDelays ? '1' : '0');
    } catch {
      // The layer just will not survive a restart.
    }
  },
  toggleLine: (line) => {
    const current = get().hidden;
    get().setHidden(current.includes(line) ? current.filter((l) => l !== line) : [...current, line]);
  },
  setHidden: (hidden) => {
    set({ hidden });
    try {
      Storage.setItemSync(HIDDEN_KEY, JSON.stringify(hidden));
      Storage.removeItemSync(OLD_FILTER_KEY);
    } catch {
      // The choice just will not survive a restart.
    }
  },
}));

/**
 * One tracker per installed timetable: its resolver and line list read
 * that database, so a new timetable gets a new tracker.
 */
let tracker: { db: Db; instance: LiveTracker; lines: Promise<LineInfo[]> } | null = null;

const trackerFor = (db: Db) => {
  if (tracker?.db !== db) {
    // New timetable: its shapes and schedules are different.
    clearDescribeCache();
    const lines = getLines(db).then((list) => {
      useLive.setState({ lines: list });
      if (oldFilter.length && useLive.getState().hidden.length === 0) {
        const shown = new Set(oldFilter);
        useLive.getState().setHidden(list.filter((line) => !shown.has(line.name)).map((line) => line.name));
        oldFilter.length = 0;
      }
      return list;
    });
    const tramLines = lines.then((list) => new Set(list.filter((line) => line.tram).map((line) => line.name)));
    let stopNames: Promise<Map<string, string>> | null = null;
    let trams: Set<string> | null = null;
    void tramLines.then((set) => (trams = set));
    tracker = {
      db,
      lines,
      instance: new LiveTracker({
        lines: async () => lineSets(await lines),
        // The timetable knows; the feed's own hint and the line number are fallbacks.
        isTram: (line, hint) => trams?.has(line) ?? (hint === 'tram' || isTramLine(line)),
        resolver: timetableResolver(db),
        impk: impkClient,
        stopNames: () => (stopNames ??= getStopNamesByCode(db)),
        routeHeading: (line, destination, lat, lon) => routeHeading(db, line, destination, lat, lon),
      }),
    };
  }
  return tracker;
};

let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;

const tick = async (run: number) => {
  const db = useTimetable.getState().db;
  if (db) {
    const { instance, lines } = trackerFor(db);
    await lines;
    try {
      const snapshot = await instance.poll();
      if (run !== generation) return;
      useLive.setState({ vehicles: snapshot.vehicles, at: snapshot.at, status: snapshot.status, comparisons: snapshot.comparisons });
    } catch {
      // Each source reports its own failure in `status`; nothing else can throw here.
    }
  }
  if (run === generation) timer = setTimeout(() => void tick(run), POLL_MS);
};

/** Start polling (map on screen, app in the foreground). Polls never overlap. */
export const startLive = () => {
  if (useLive.getState().polling) return;
  generation += 1;
  useLive.setState({ polling: true });
  void tick(generation);
};

export const stopLive = () => {
  generation += 1;
  if (timer) clearTimeout(timer);
  timer = null;
  useLive.setState({ polling: false });
};
