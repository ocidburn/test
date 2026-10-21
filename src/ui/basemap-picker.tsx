import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BASEMAPS, GROUP_NAMES, keyFor, KEY_NAMES, type BasemapGroup } from '../core/map/basemaps';
import { useBasemap } from '../state/basemap';
import { useTheme } from './theme';

const GROUPS = Object.keys(GROUP_NAMES) as BasemapGroup[];

/** Base layer choice on the map-layers screen; layers whose key is missing say where to add it. */
export function BasemapPicker() {
  const theme = useTheme();
  const selected = useBasemap((state) => state.selected);
  const keys = useBasemap((state) => state.keys);
  const select = useBasemap((state) => state.select);

  return (
    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      <Text style={{ color: theme.text, fontSize: 16 }}>Подложка карты</Text>
      {GROUPS.map((group) => {
        const items = BASEMAPS.filter((b) => b.group === group);
        if (!items.length) return null;
        return (
          <View key={group} style={styles.group}>
            <Text style={{ color: theme.muted, fontSize: 12 }}>{GROUP_NAMES[group]}</Text>
            <View style={styles.chips}>
              {items.map((basemap) => {
                const on = basemap.id === selected;
                const key = keyFor(basemap);
                const missing = key !== null && !keys[key];
                return (
                  <Pressable
                    key={basemap.id}
                    onPress={() => select(basemap.id)}
                    style={[
                      styles.chip,
                      { borderColor: theme.accent, backgroundColor: on ? theme.accent : 'transparent', opacity: missing && !on ? 0.5 : 1 },
                    ]}
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={{ color: on ? '#FFFFFF' : theme.accent, fontSize: 13, fontWeight: '600' }}>{basemap.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
      <Text style={{ color: theme.muted, fontSize: 12 }}>
        Бледные — без ключа: {Object.values(KEY_NAMES).join(', ')}. Ключи вводятся в «Данных».
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 12, gap: 10 },
  group: { gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
});
