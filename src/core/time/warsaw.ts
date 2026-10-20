/**
 * Wall-clock time in Wrocław without relying on Intl time zone data.
 *
 * Hermes ships Intl, but its time zone support differs between iOS and
 * Android builds, and a wrong offset shifts every departure by an hour with no
 * error anywhere. Poland follows the EU rule, so the offset is computed:
 * CEST (+2) from the last Sunday of March 01:00 UTC to the last Sunday of
 * October 01:00 UTC, CET (+1) otherwise.
 */

const HOUR_MS = 3_600_000;
export const DAY_SECONDS = 86_400;

/** Epoch ms of 01:00 UTC on the last Sunday of a month (0-based). */
const lastSundayAt0100Utc = (year: number, month: number): number => {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const date = lastDay.getUTCDate() - lastDay.getUTCDay();
  return Date.UTC(year, month, date, 1);
};

/** UTC offset of Europe/Warsaw at an instant, in minutes (60 or 120). */
export const warsawOffsetMinutes = (utcMs: number): number => {
  const year = new Date(utcMs).getUTCFullYear();
  const summer = utcMs >= lastSundayAt0100Utc(year, 2) && utcMs < lastSundayAt0100Utc(year, 9);
  return summer ? 120 : 60;
};

export type WarsawParts = {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  hour: number;
  minute: number;
  second: number;
  /** YYYYMMDD as a number, the way GTFS writes dates. */
  dateKey: number;
};

export const warsawParts = (utcMs: number): WarsawParts => {
  const shifted = new Date(utcMs + warsawOffsetMinutes(utcMs) * 60_000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  return {
    year,
    month,
    day,
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    dateKey: year * 10_000 + month * 100 + day,
  };
};

export const warsawDateKey = (utcMs: number): number => warsawParts(utcMs).dateKey;

/** Split YYYYMMDD into its parts. */
export const splitDateKey = (dateKey: number) => ({
  year: Math.floor(dateKey / 10_000),
  month: Math.floor(dateKey / 100) % 100,
  day: dateKey % 100,
});

/** The date key `days` calendar days away from `dateKey`. */
export const addDays = (dateKey: number, days: number): number => {
  const { year, month, day } = splitDateKey(dateKey);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.getUTCFullYear() * 10_000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
};

/** Weekday of a date key, 0 = Sunday. */
export const weekdayOf = (dateKey: number): number => {
  const { year, month, day } = splitDateKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

/**
 * Epoch ms that GTFS times on `dateKey` count from.
 *
 * The spec defines a stop time as seconds since "noon minus 12h" of the
 * service day, which equals midnight except on the two DST switch days. The
 * offset is taken at 10:00 UTC, safely away from the 01:00 UTC switch.
 */
export const serviceDayBaseMs = (dateKey: number): number => {
  const { year, month, day } = splitDateKey(dateKey);
  const noonUtc = Date.UTC(year, month - 1, day, 12) - warsawOffsetMinutes(Date.UTC(year, month - 1, day, 10)) * 60_000;
  return noonUtc - 12 * HOUR_MS;
};

/** "HH:MM" of an instant, in Wrocław. */
export const formatClock = (utcMs: number): string => {
  const { hour, minute } = warsawParts(utcMs);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

/** "DD.MM.YYYY" for a date key. */
export const formatDateKey = (dateKey: number): string => {
  const { year, month, day } = splitDateKey(dateKey);
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
};
