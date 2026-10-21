import { create } from 'zustand';

import type { LonLatBox } from '../core/map/tiles';

/** What the map shows now, for screens over it (the offline download of "this area"). */
export const useMapView = create<{ box: LonLatBox | null; setBox: (box: LonLatBox) => void }>((set) => ({
  box: null,
  setBox: (box) => set({ box }),
}));
