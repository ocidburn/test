import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { basemapById, canGoOffline } from '../core/map/basemaps';
import { countTiles, WROCLAW_BOX, type LonLatBox } from '../core/map/tiles';
import { useBasemap } from '../state/basemap';
import { useMapView } from '../state/map-view';
import { OFFLINE_MIN_Z, useOffline } from '../state/offline';
import { useTheme } from './theme';

/** A rough size per tile for the estimate: orthophoto JPEGs at 256 px. */
const BYTES_PER_TILE = 25_000;
const ZOOMS = [15, 16, 17, 18];
/** Beyond this the download would take hours and gigabytes: pick a smaller area or zoom. */
const MAX_TILES = 60_000;

/** WMS tiles are rendered per request, ~1.5 s each, two at a time. */
const duration = (tiles: number) => {
  const minutes = Math.ceil((tiles * 1.5) / 2 / 60);
  return minutes < 90 ? `${minutes} мин` : `${Math.round(minutes / 60)} ч`;
};

const megabytes = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} ГБ` : `${Math.max(1, Math.round(bytes / 1e6))} МБ`);

/** Offline download for the chosen base layer, on the Lines screen, when its terms allow it. */
export function OfflineCard() {
  const theme = useTheme();
  const basemap = basemapById(useBasemap((state) => state.selected));
  const viewBox = useMapView((state) => state.box);
  const pkg = useOffline((state) => state.packages[basemap.id]);
  const job = useOffline((state) => state.job);
  const error = useOffline((state) => state.error);
  const start = useOffline((state) => state.start);
  const cancel = useOffline((state) => state.cancel);
  const remove = useOffline((state) => state.remove);
  const [area, setArea] = useState<'city' | 'view'>('city');
  const [maxZ, setMaxZ] = useState(16);

  if (!canGoOffline(basemap)) {
    return (
      <Text style={[styles.note, { color: theme.muted }]}>
        Офлайн-загрузка есть только у подложек, чьи условия её разрешают: ортофото Польши HD и ортофото Вроцлава 2024. OSM, Thunderforest,
        CARTO, Stadia и Google запрещают массовую загрузку или требуют платный тариф; условия городских карт SIP ещё не прочитаны.
      </Text>
    );
  }

  const box: LonLatBox | null = area === 'city' ? WROCLAW_BOX : viewBox;
  const tiles = box ? countTiles(box, OFFLINE_MIN_Z, maxZ) : 0;
  const running = job?.id === basemap.id ? job : null;
  const busyElsewhere = !!job && !running;

  const onStart = () => {
    if (!box) return;
    Alert.alert(
      'Загрузить офлайн?',
      `${tiles.toLocaleString('ru')} плиток, около ${megabytes(tiles * BYTES_PER_TILE)}.` +
        (basemap.kind === 'wms' ? ` Сервер собирает каждую плитку на лету: займёт около ${duration(tiles)}.` : '') +
        ' Лучше по Wi-Fi; держите приложение открытым. Уже скачанное не загружается заново.',
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Загрузить', onPress: () => void start(basemap, box, maxZ) },
      ],
    );
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      <Text style={{ color: theme.text, fontSize: 16 }}>Офлайн: {basemap.name}</Text>
      {pkg ? (
        <Text style={{ color: theme.muted, fontSize: 13 }}>
          {pkg.finishedAt ? 'Сохранено' : 'Загружено не полностью'}: {pkg.saved.toLocaleString('ru')} из {pkg.tiles.toLocaleString('ru')} плиток,{' '}
          {megabytes(pkg.bytes)}, до масштаба {pkg.maxZ}
          {pkg.failed ? ` · не загрузилось ${pkg.failed}` : ''}. Карта берёт их с телефона, без сети.
        </Text>
      ) : (
        <Text style={{ color: theme.muted, fontSize: 13 }}>Не загружено. Без пакета плитки грузятся из сети.</Text>
      )}

      {running ? (
        <>
          <Text style={{ color: theme.text, fontSize: 13 }}>
            {running.progress.total
              ? `Загружаю: ${running.progress.done.toLocaleString('ru')} из ${running.progress.total.toLocaleString('ru')} · ${megabytes(running.progress.bytes)}`
              : 'Начинаю…'}
            {running.progress.failed ? ` · ошибок ${running.progress.failed}` : ''}
          </Text>
          <Pressable onPress={cancel} style={[styles.button, { borderColor: theme.danger }]}>
            <Text style={{ color: theme.danger, fontWeight: '600' }}>Остановить</Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={styles.row}>
            {(['city', 'view'] as const).map((value) => (
              <Chip key={value} on={area === value} onPress={() => setArea(value)} label={value === 'city' ? 'Весь Вроцлав' : 'Видимая область'} />
            ))}
          </View>
          <View style={styles.row}>
            {ZOOMS.map((z) => (
              <Chip key={z} on={maxZ === z} onPress={() => setMaxZ(z)} label={`до ${z}`} />
            ))}
          </View>
          <Text style={{ color: tiles > MAX_TILES ? theme.danger : theme.muted, fontSize: 12 }}>
            {box ? `${tiles.toLocaleString('ru')} плиток, ~${megabytes(tiles * BYTES_PER_TILE)}` : 'Откройте карту, чтобы выбрать видимую область'}
            {tiles > MAX_TILES ? ' — слишком много: уменьшите масштаб или область' : ''}
          </Text>
          <Pressable
            disabled={!box || tiles > MAX_TILES || busyElsewhere}
            onPress={onStart}
            style={[styles.button, { borderColor: theme.accent, opacity: !box || tiles > MAX_TILES || busyElsewhere ? 0.4 : 1 }]}
          >
            <Text style={{ color: theme.accent, fontWeight: '600' }}>{pkg ? 'Догрузить / обновить область' : 'Загрузить офлайн'}</Text>
          </Pressable>
          {pkg ? (
            <Pressable
              onPress={() =>
                Alert.alert('Удалить офлайн-карту?', megabytes(pkg.bytes), [
                  { text: 'Отмена', style: 'cancel' },
                  { text: 'Удалить', style: 'destructive', onPress: () => remove(basemap.id) },
                ])
              }
              style={[styles.button, { borderColor: theme.danger }]}
            >
              <Text style={{ color: theme.danger, fontWeight: '600' }}>Удалить офлайн-карту</Text>
            </Pressable>
          ) : null}
        </>
      )}
      {error ? <Text style={{ color: theme.danger, fontSize: 12 }}>{error}</Text> : null}
    </View>
  );
}

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.chip, { borderColor: theme.accent, backgroundColor: on ? theme.accent : 'transparent' }]}>
      <Text style={{ color: on ? '#FFFFFF' : theme.accent, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 12, gap: 10 },
  note: { fontSize: 12, paddingHorizontal: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  button: { height: 40, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
