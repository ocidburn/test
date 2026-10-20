import {
  addDays,
  formatClock,
  serviceDayBaseMs,
  warsawDateKey,
  warsawOffsetMinutes,
  warsawParts,
  weekdayOf,
} from '../src/core/time/warsaw';

describe('Warsaw time without Intl', () => {
  test('summer and winter offsets', () => {
    expect(warsawOffsetMinutes(Date.parse('2026-07-01T12:00:00Z'))).toBe(120);
    expect(warsawOffsetMinutes(Date.parse('2026-12-01T12:00:00Z'))).toBe(60);
  });

  test('switches exactly at 01:00 UTC on the last Sundays of March and October', () => {
    // 2026: 29 March and 25 October.
    expect(warsawOffsetMinutes(Date.parse('2026-03-29T00:59:59Z'))).toBe(60);
    expect(warsawOffsetMinutes(Date.parse('2026-03-29T01:00:00Z'))).toBe(120);
    expect(warsawOffsetMinutes(Date.parse('2026-10-25T00:59:59Z'))).toBe(120);
    expect(warsawOffsetMinutes(Date.parse('2026-10-25T01:00:00Z'))).toBe(60);
  });

  test('agrees with Intl for a year of hourly samples', () => {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Warsaw',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    for (let t = Date.parse('2026-01-01T00:00:00Z'); t < Date.parse('2027-01-01T00:00:00Z'); t += 3_600_000) {
      const parts = Object.fromEntries(formatter.formatToParts(t).map((p) => [p.type, p.value]));
      const ours = warsawParts(t);
      expect([ours.year, ours.month, ours.day, ours.hour]).toEqual([
        Number(parts.year),
        Number(parts.month),
        Number(parts.day),
        Number(parts.hour),
      ]);
    }
  });

  test('date keys and calendar arithmetic', () => {
    expect(warsawDateKey(Date.parse('2026-06-15T22:30:00Z'))).toBe(20260616);
    expect(addDays(20260301, -1)).toBe(20260228);
    expect(addDays(20261231, 1)).toBe(20270101);
    expect(weekdayOf(20260615)).toBe(1);
  });

  test('service day base is local midnight, noon-minus-12h on DST days', () => {
    expect(serviceDayBaseMs(20260615)).toBe(Date.parse('2026-06-15T00:00:00+02:00'));
    expect(serviceDayBaseMs(20261215)).toBe(Date.parse('2026-12-15T00:00:00+01:00'));
    // On 2026-03-29 noon is CEST, so the base is 23:00 CET the night before.
    expect(serviceDayBaseMs(20260329)).toBe(Date.parse('2026-03-29T12:00:00+02:00') - 12 * 3_600_000);
  });

  test('formats a clock in Wrocław', () => {
    expect(formatClock(Date.parse('2026-06-15T06:07:00Z'))).toBe('08:07');
  });
});
