import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { KEY_NAMES, type KeyName } from '../core/map/basemaps';
import { useBasemap } from '../state/basemap';
import { useTheme } from './theme';

const NAMES = Object.keys(KEY_NAMES) as KeyName[];

const HINTS: Record<KeyName, string> = {
  thunderforest: 'thunderforest.com → Account → API key (бесплатный тариф Hobby, 150 000 плиток в месяц)',
  carto: 'carto.com/basemaps → бесплатный ключ по e-mail; без ограничения по приложению',
  stadia: 'client.stadiamaps.com → API key (бесплатно 200 000 плиток в месяц, некоммерческое)',
  google: 'Google Cloud: включить Map Tiles API, создать ключ; нужна оплата, 100 000 плиток в месяц бесплатно. Спутник Google для ЕЭЗ не отдаётся',
};

/** API keys for map layers on the Data screen; kept in the Keychain, never shown back. */
export function MapKeys() {
  const theme = useTheme();
  const keys = useBasemap((state) => state.keys);
  const saveKey = useBasemap((state) => state.saveKey);
  const [drafts, setDrafts] = useState<Partial<Record<KeyName, string>>>({});
  const [note, setNote] = useState<string | null>(null);

  const save = async () => {
    const changed = NAMES.filter((name) => drafts[name] !== undefined);
    for (const name of changed) await saveKey(name, drafts[name] ?? '');
    setDrafts({});
    setNote(changed.length ? `Сохранено: ${changed.map((name) => KEY_NAMES[name]).join(', ')}` : 'Нечего сохранять');
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      {NAMES.map((name) => (
        <View key={name} style={styles.field}>
          <Text style={{ color: theme.muted, fontSize: 12 }}>
            {KEY_NAMES[name]}
            {keys[name] ? ' · сохранён' : ''}
          </Text>
          <TextInput
            style={[styles.input, { color: theme.text, backgroundColor: theme.inputBackground }]}
            value={drafts[name] ?? ''}
            onChangeText={(text) => setDrafts({ ...drafts, [name]: text })}
            placeholder={keys[name] ? 'оставить как есть' : 'ключ API'}
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <Text style={{ color: theme.muted, fontSize: 11 }}>{HINTS[name]}</Text>
        </View>
      ))}
      <Pressable
        onPress={() => void save().catch((error: Error) => setNote(error.message))}
        style={({ pressed }) => [styles.button, { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1 }]}
      >
        <Text style={styles.buttonText}>Сохранить ключи</Text>
      </Pressable>
      {note ? <Text style={{ color: theme.muted, fontSize: 12 }}>{note}</Text> : null}
      <Text style={{ color: theme.muted, fontSize: 12 }}>
        Хранятся в Связке ключей iPhone и уходят только своему сервису. Чтобы удалить ключ, введите пробел и сохраните.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, borderRadius: 12, padding: 12, gap: 10 },
  field: { gap: 4 },
  input: { height: 40, borderRadius: 8, paddingHorizontal: 10, fontSize: 15 },
  button: { height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
