import { lineGroup, lineVisibility } from '../src/core/line-groups';

const LINES = [
  { name: '14', tram: true },
  { name: '7', tram: true },
  { name: '145', tram: false },
  { name: 'A', tram: false },
  { name: '612', tram: false },
  { name: '906', tram: false },
  { name: '240', tram: false },
];

describe('line groups', () => {
  test('every line in one group; the timetable says what is a tram', () => {
    expect(LINES.map((l) => lineGroup(l.name, l.tram))).toEqual(['tram', 'tram', 'bus', 'bus', 'suburban', 'suburban', 'night']);
    // A bus replacing trams keeps a tram-like number but is a bus.
    expect(lineGroup('7', false)).toBe('bus');
  });

  test('nothing hidden shows everything, unknown lines too', () => {
    const v = lineVisibility(LINES, []);
    expect(v.all).toBe(true);
    expect(v.isShown('B7', false)).toBe(true);
  });

  test('a hidden line goes; its group stays while another line is shown', () => {
    const v = lineVisibility(LINES, ['14']);
    expect([v.isShown('14', true), v.isShown('7', true), v.isShown('T9', true)]).toEqual([false, true, true]);
    expect(v.shownLines).not.toContain('14');
  });

  test('a group with nothing selected shows nothing, unlisted lines included', () => {
    const v = lineVisibility(LINES, ['14', '7']);
    expect(v.isShown('T9', true)).toBe(false);
    expect(v.isShown('145', false)).toBe(true);
  });
});
