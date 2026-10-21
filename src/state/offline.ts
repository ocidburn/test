import { create } from 'zustand';

import { BASEMAPS, canGoOffline, tileTemplate, type Basemap } from '../core/map/basemaps';
import type { LonLatBox } from '../core/map/tiles';
import { deletePackage, downloadPackage, readPackage, removeOrphans, type OfflinePackage, type Progress } from '../platform/offline-tiles';
import { useBasemap } from './basemap';

/** The smallest zoom saved: below it a city is a few pixels anyway. */
export const OFFLINE_MIN_Z = 10;

type Job = { id: string; progress: Progress; controller: AbortController };

type OfflineState = {
  packages: Record<string, OfflinePackage>;
  job: Job | null;
  error: string | null;
  start: (basemap: Basemap, box: LonLatBox, maxZ: number) => Promise<void>;
  cancel: () => void;
  remove: (id: string) => void;
};

const loadPackages = () => {
  const packages: Record<string, OfflinePackage> = {};
  try {
    removeOrphans(new Set(BASEMAPS.filter(canGoOffline).map((b) => b.id)));
  } catch {
    // Left for the next launch.
  }
  for (const basemap of BASEMAPS.filter(canGoOffline)) {
    const pkg = readPackage(basemap.id);
    if (pkg) packages[basemap.id] = pkg;
  }
  return packages;
};

export const useOffline = create<OfflineState>((set, get) => ({
  packages: loadPackages(),
  job: null,
  error: null,
  start: async (basemap, box, maxZ) => {
    if (get().job || !canGoOffline(basemap) || (basemap.kind !== 'xyz' && basemap.kind !== 'wms')) return;
    const template = tileTemplate(basemap, { dark: false, keys: useBasemap.getState().keys });
    if (!template) return;
    const controller = new AbortController();
    set({ job: { id: basemap.id, progress: { done: 0, total: 0, failed: 0, bytes: 0 }, controller }, error: null });
    try {
      const pkg = await downloadPackage(
        { id: basemap.id, template, kind: basemap.kind, box, minZ: OFFLINE_MIN_Z, maxZ },
        {
          signal: controller.signal,
          onProgress: (progress) => {
            const job = get().job;
            if (job?.controller === controller) set({ job: { ...job, progress } });
          },
        },
      );
      set({ packages: { ...get().packages, [basemap.id]: pkg } });
    } catch (error) {
      set({ error: (error as Error).message });
    } finally {
      if (get().job?.controller === controller) set({ job: null });
    }
  },
  cancel: () => get().job?.controller.abort(),
  remove: (id) => {
    if (get().job?.id === id) get().job?.controller.abort();
    try {
      deletePackage(id);
    } catch (error) {
      set({ error: (error as Error).message });
    }
    const packages = { ...get().packages };
    delete packages[id];
    set({ packages });
  },
}));
