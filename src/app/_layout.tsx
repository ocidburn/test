import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useTimetable } from '../state/timetable';
import { useTheme } from '../ui/theme';

export default function RootLayout() {
  const theme = useTheme();
  const init = useTimetable((state) => state.init);
  const update = useTimetable((state) => state.update);

  useEffect(() => {
    void init();
    // Coming back to the app is the moment to look for a new timetable;
    // `update` itself skips the network unless a check is due.
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void update();
    });
    return () => subscription.remove();
  }, [init, update]);

  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.surface },
          headerTintColor: theme.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Остановки' }} />
        <Stack.Screen name="stop/[name]" options={{ title: '' }} />
        <Stack.Screen name="settings" options={{ title: 'Расписание', presentation: 'modal' }} />
      </Stack>
    </>
  );
}
