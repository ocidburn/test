import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

const KEY = 'favorites.stops';

const read = (): string[] => {
  try {
    const raw = Storage.getItemSync(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
};

type FavoritesState = {
  /** Stop names, in the order they were added. */
  stops: string[];
  toggle: (name: string) => void;
};

/** Favourite stops, kept on the phone across launches. */
export const useFavorites = create<FavoritesState>((set, get) => ({
  stops: read(),
  toggle: (name) => {
    const current = get().stops;
    const stops = current.includes(name) ? current.filter((stop) => stop !== name) : [...current, name];
    set({ stops });
    try {
      Storage.setItemSync(KEY, JSON.stringify(stops));
    } catch {
      // Kept for this session only.
    }
  },
}));
