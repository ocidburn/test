import { compareSources, describeComparison, describeUnmatched } from '../src/core/realtime/compare';
import type { LiveVehicle } from '../src/core/realtime/types';

const AT = Date.parse('2026-10-21T13:00:00Z');

const vehicle = (over: Partial<LiveVehicle>): LiveVehicle => ({
  id: 'x',
  line: '18',
  tram: true,
  lat: 51.1,
  lon: 17.03,
  heading: null,
  source: 'impk',
  vehicleNumber: null,
  brigade: null,
  headsign: null,
  tripId: null,
  delaySeconds: null,
  positionAt: AT,
  ...over,
});

describe('comparing feeds with iMPK', () => {
  const impk = [
    vehicle({ id: 'impk:3101', vehicleNumber: '3101', lat: 51.1, lon: 17.03 }),
    vehicle({ id: 'impk:3102', vehicleNumber: '3102', lat: 51.1, lon: 17.05 }),
    vehicle({ id: 'impk:4102', vehicleNumber: '4102', line: '715', tram: false, lat: 51.11, lon: 17.09 }),
  ];

  test('MPK pairs by line and distance, nearest first, each once', () => {
    const mpk = [
      // 3101 is 22 m from this one and 70 m from the next; the nearer pair wins.
      vehicle({ id: 'mpk:a', source: 'mpk', lat: 51.1002, lon: 17.03 }),
      vehicle({ id: 'mpk:b', source: 'mpk', lat: 51.1, lon: 17.031 }),
      // Same place as 4102 but another line: not the same vehicle.
      vehicle({ id: 'mpk:c', source: 'mpk', line: '9', lat: 51.11, lon: 17.09 }),
    ];
    const entry = compareSources(AT, impk, mpk, null);
    expect(entry.counts).toEqual({ impk: 3, mpk: 3, openData: null });
    expect(entry.mpk).toEqual({
      matched: 1,
      onlyImpk: 2,
      onlyOther: 2,
      medianMeters: 22,
      p90Meters: 22,
      medianLagSeconds: null,
      onlyImpkVehicles: ['18·3102', '715·4102'],
      // MPK has no side number: its own key stands in.
      onlyOtherVehicles: ['9·c', '18·b'],
    });
    expect(entry.openData).toBeNull();
  });

  test('Open Data pairs by side number and shows its lag', () => {
    const openData = [
      vehicle({ id: 'od:3101', source: 'open-data', vehicleNumber: '3101', lat: 51.101, positionAt: AT - 600_000 }),
      vehicle({ id: 'od:4102', source: 'open-data', vehicleNumber: '4102', line: '715', lat: 51.11, lon: 17.09, positionAt: AT - 540_000 }),
      vehicle({ id: 'od:9999', source: 'open-data', vehicleNumber: '9999' }),
    ];
    const side = compareSources(AT, impk, null, openData).openData!;
    expect(side).toMatchObject({ matched: 2, onlyImpk: 1, onlyOther: 1, medianLagSeconds: 600 });
    expect(describeComparison('Open Data', side, 3)).toBe(
      'Open Data 3: общих 2, расхождение медиана 111 м, 90% до 111 м · только в iMPK 1, только в Open Data 1 · отстаёт на 10 мин',
    );
    expect(describeComparison('MPK', null, null)).toBe('MPK: в этот раз не опрашивался');
    expect(describeUnmatched('Open Data', side)).toEqual(['только в iMPK (против Open Data): 18·3102', 'только в Open Data: 18·9999']);
  });
});
