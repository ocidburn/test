import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { useImpk } from '../state/impk';
import { useTheme } from './theme';

/** iMPK login on the Data screen: the user's own account, kept on the phone. */
export function ImpkSettings() {
  const theme = useTheme();
  const saved = useImpk();
  const [enabled, setEnabled] = useState(saved.enabled);
  const [url, setUrl] = useState(saved.url);
  const [username, setUsername] = useState(saved.username);
  // Never read back from the Keychain into the form; empty means "keep".
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const load = saved.load;
  useEffect(() => {
    void load();
  }, [load]);

  const saveAndTest = async () => {
    setBusy(true);
    try {
      await saved.save({ enabled, url, username }, password ? password : null);
      setPassword('');
      await useImpk.getState().test();
    } finally {
      setBusy(false);
    }
  };

  const input = [styles.input, { color: theme.text, backgroundColor: theme.inputBackground }];
  return (
    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      <View style={styles.row}>
        <Text style={{ color: theme.text, fontSize: 16, flex: 1 }}>Использовать iMPK</Text>
        <Switch value={enabled} onValueChange={setEnabled} />
      </View>
      <TextInput
        style={input}
        value={url}
        onChangeText={setUrl}
        placeholder="Адрес API"
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <TextInput
        style={input}
        value={username}
        onChangeText={setUsername}
        placeholder="Логин"
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="username"
      />
      <TextInput
        style={input}
        value={password}
        onChangeText={setPassword}
        placeholder={saved.hasPassword ? 'Пароль сохранён' : 'Пароль'}
        placeholderTextColor={theme.muted}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
      />
      <Pressable
        disabled={busy || saved.probing}
        onPress={() => void saveAndTest()}
        style={({ pressed }) => [styles.button, { backgroundColor: theme.accent, opacity: busy || saved.probing ? 0.5 : pressed ? 0.8 : 1 }]}
      >
        <Text style={styles.buttonText}>{busy || saved.probing ? 'Проверяю…' : 'Сохранить и проверить'}</Text>
      </Pressable>
      {saved.probe ? (
        <Text style={{ color: saved.probe.ok ? theme.text : theme.danger, fontSize: 12 }} selectable>
          {saved.probe.ok ? 'Подключение есть: ' : 'Ошибка: '}
          {saved.probe.text}
        </Text>
      ) : null}
      <Text style={{ color: theme.muted, fontSize: 12 }}>
        Свой логин MPK. Пароль хранится в Связке ключей iPhone и уходит только на этот адрес. Соединение — обычный HTTPS с проверкой сертификата.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, borderRadius: 12, padding: 12, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center' },
  input: { height: 40, borderRadius: 8, paddingHorizontal: 10, fontSize: 15 },
  button: { height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
