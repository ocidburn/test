import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import { basemapById, DEFAULT_BASEMAP, KEY_NAMES, type KeyName } from '../core/map/basemaps';
import { createGoogleSession, sessionUsable, type GoogleSession } from '../core/map/google-tiles';

const SELECTED_KEY = 'map.basemap';
const SESSION_KEY = 'map.googleSession';
/** Keys live in the iOS Keychain, like the iMPK password. */
const KEYCHAIN = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const keychainName = (name: KeyName) => `map.key.${name}`;
const NAMES = Object.keys(KEY_NAMES) as KeyName[];

const readSelected = () => {
  try {
    return basemapById(Storage.getItemSync(SELECTED_KEY) ?? DEFAULT_BASEMAP).id;
  } catch {
    return DEFAULT_BASEMAP;
  }
};

const readSessions = (): GoogleSession[] => {
  try {
    const raw = Storage.getItemSync(SESSION_KEY);
    return raw ? (JSON.parse(raw) as GoogleSession[]) : [];
  } catch {
    return [];
  }
};

type BasemapState = {
  selected: string;
  /** The keys themselves, read from the Keychain at launch; empty string when not set. */
  keys: Partial<Record<KeyName, string>>;
  loaded: boolean;
  select: (id: string) => void;
  load: () => Promise<void>;
  saveKey: (name: KeyName, value: string) => Promise<void>;
};

export const useBasemap = create<BasemapState>((set, get) => ({
  selected: readSelected(),
  keys: {},
  loaded: false,
  select: (id) => {
    set({ selected: id });
    try {
      Storage.setItemSync(SELECTED_KEY, id);
    } catch {
      // The choice just will not survive a restart.
    }
  },
  load: async () => {
    const keys: Partial<Record<KeyName, string>> = {};
    for (const name of NAMES) {
      const value = await SecureStore.getItemAsync(keychainName(name), KEYCHAIN).catch(() => null);
      if (value) keys[name] = value;
    }
    set({ keys, loaded: true });
  },
  saveKey: async (name, value) => {
    const trimmed = value.trim();
    if (trimmed) await SecureStore.setItemAsync(keychainName(name), trimmed, KEYCHAIN);
    else await SecureStore.deleteItemAsync(keychainName(name), KEYCHAIN);
    set({ keys: { ...get().keys, [name]: trimmed || undefined } });
    // A new Google key needs new sessions.
    if (name === 'google') sessions = [];
    try {
      if (name === 'google') Storage.setItemSync(SESSION_KEY, '[]');
    } catch {
      // Sessions are made again anyway.
    }
  },
}));

let sessions = readSessions();

/** A Google tile session for this map type, reused until shortly before it expires. */
export const googleSession = async (mapType: GoogleSession['mapType'], hybrid: boolean): Promise<GoogleSession | null> => {
  const key = useBasemap.getState().keys.google;
  if (!key) return null;
  const now = Date.now();
  const kept = sessions.find((s) => s.mapType === mapType && s.hybrid === hybrid);
  if (kept && sessionUsable(kept, now)) return kept;
  const fresh = await createGoogleSession(key, { mapType, hybrid }, { now });
  sessions = [...sessions.filter((s) => s !== kept), fresh];
  try {
    Storage.setItemSync(SESSION_KEY, JSON.stringify(sessions));
  } catch {
    // Made again next launch.
  }
  return fresh;
};
