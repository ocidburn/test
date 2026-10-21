import { useColorScheme } from 'react-native';

import type { DelayStatus } from '../core/realtime/trip-match';

const light = {
  background: '#F4F5F7',
  surface: '#FFFFFF',
  text: '#111418',
  muted: '#5F6670',
  border: '#E1E4E8',
  accent: '#0A64D6',
  /** Reserved for countdowns: the one loud colour on screen. */
  amber: '#B45309',
  danger: '#B42318',
  inputBackground: '#EDEFF2',
  /** Delay text: on time, a minute or more early (riders can miss it: never shown as on time). */
  onTime: '#15803D',
  early: '#1D4ED8',
};

const dark: typeof light = {
  background: '#0E1013',
  surface: '#171A1F',
  text: '#F2F4F7',
  muted: '#9AA3AE',
  border: '#272B33',
  accent: '#5AA2FF',
  amber: '#F59E0B',
  danger: '#F97066',
  inputBackground: '#20242B',
  onTime: '#4ADE80',
  early: '#7AB4FF',
};

export type Theme = typeof light;

export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);

/** The text colour for a delay class (boards, the vehicle sheet); unknown is muted. */
export const delayTextColor = (theme: Theme, status: DelayStatus): string =>
  ({ early: theme.early, ok: theme.onTime, mid: theme.amber, late: theme.danger, none: theme.muted })[status];

/** Badge colours; each clears 4.5:1 against white text. */
export const lineColor = (line: string, tram: boolean): string => {
  if (tram) return '#B3122B';
  const number = /^\d+$/.test(line) ? Number(line) : null;
  if (number !== null && number >= 200 && number < 300) return '#1F2937';
  if (/^[A-Z]$/.test(line)) return '#6B21A8';
  if (number !== null && number >= 600) return '#166534';
  return '#1D4F91';
};
