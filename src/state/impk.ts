import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import { DigestSession } from '../core/net/digest';
import { IMPK_DEFAULT_URL, parseParams, probeImpk } from '../core/realtime/impk';

/** How much of an answer the Data screen keeps, to copy and send. */
const SHOWN_CHARS = 4000;

const SETTINGS_KEY = 'impk.settings';
/** The password lives in the iOS Keychain, never in the app's own storage. */
const PASSWORD_KEY = 'impk.password';
const KEYCHAIN = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

type Settings = { enabled: boolean; url: string; username: string };

const readSettings = (): Settings => {
  try {
    const raw = Storage.getItemSync(SETTINGS_KEY);
    if (raw) return { enabled: false, url: IMPK_DEFAULT_URL, username: '', ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Defaults below.
  }
  return { enabled: false, url: IMPK_DEFAULT_URL, username: '' };
};

type ImpkState = Settings & {
  hasPassword: boolean;
  /** The last connection check: what came back, or why it failed. */
  probe: { at: number; ok: boolean; text: string } | null;
  probing: boolean;
  load: () => Promise<void>;
  save: (settings: Settings, password: string | null) => Promise<void>;
  test: (fn: string, params: string) => Promise<void>;
};

let client: { key: string; session: DigestSession } | null = null;

/** The saved login as a Digest session for the tracker; null while iMPK is off or not filled in. */
export const impkClient = async (): Promise<{ url: string; session: DigestSession } | null> => {
  const { enabled, url, username } = useImpk.getState();
  if (!enabled || !url || !username) return null;
  const password = await SecureStore.getItemAsync(PASSWORD_KEY, KEYCHAIN);
  if (!password) return null;
  // One session per login, so the Digest nonce is reused between polls.
  const key = `${url}\n${username}\n${password}`;
  if (client?.key !== key) client = { key, session: new DigestSession({ username, password }) };
  return { url, session: client.session };
};

export const useImpk = create<ImpkState>((set, get) => ({
  ...readSettings(),
  hasPassword: false,
  probe: null,
  probing: false,
  load: async () => {
    const password = await SecureStore.getItemAsync(PASSWORD_KEY, KEYCHAIN).catch(() => null);
    set({ hasPassword: !!password });
  },
  save: async (settings, password) => {
    if (password !== null) {
      if (password) await SecureStore.setItemAsync(PASSWORD_KEY, password, KEYCHAIN);
      else await SecureStore.deleteItemAsync(PASSWORD_KEY, KEYCHAIN);
    }
    const clean = { enabled: settings.enabled, url: settings.url.trim(), username: settings.username.trim() };
    Storage.setItemSync(SETTINGS_KEY, JSON.stringify(clean));
    set({ ...clean, hasPassword: password === null ? get().hasPassword : !!password, probe: null });
  },
  test: async (fn, params) => {
    set({ probing: true });
    try {
      const { url, username } = get();
      const password = await SecureStore.getItemAsync(PASSWORD_KEY, KEYCHAIN);
      if (!url || !username || !password) throw new Error('нужны адрес, логин и пароль');
      const result = await probeImpk(new DigestSession({ username, password }), url, fn.trim(), parseParams(params));
      const cut = result.body.length > SHOWN_CHARS ? `\n… (показано ${SHOWN_CHARS} из ${result.body.length})` : '';
      set({
        probe: {
          at: Date.now(),
          ok: true,
          text: `${fn} · ${result.contentType ?? 'без Content-Type'} · ${result.bytes} символов · ${result.shape}\n\n${result.body.slice(0, SHOWN_CHARS)}${cut}`,
        },
      });
    } catch (error) {
      set({ probe: { at: Date.now(), ok: false, text: (error as Error).message } });
    } finally {
      set({ probing: false });
    }
  },
}));
