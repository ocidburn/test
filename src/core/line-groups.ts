import { lineToType } from './lines';

/** The groups of the Lines screen; every line falls in exactly one. */
export type LineGroup = 'tram' | 'bus' | 'suburban' | 'night';

export const LINE_GROUPS: { group: LineGroup; title: string }[] = [
  { group: 'tram', title: 'Трамваи' },
  { group: 'bus', title: 'Автобусы' },
  { group: 'suburban', title: 'Пригородные' },
  { group: 'night', title: 'Ночные' },
];

export const lineGroup = (line: string, tram: boolean): LineGroup => {
  if (tram) return 'tram';
  const type = lineToType(line);
  if (type === 'busSuburban' || type === 'busZone') return 'suburban';
  if (type === 'busNight') return 'night';
  return 'bus';
};

/**
 * Which vehicles the map shows. Lines are shown unless hidden, so a line new in
 * the next timetable appears by itself. A group whose every line is hidden is
 * hidden whole: then a vehicle on a line the timetable does not list (a
 * replacement service) does not slip through either.
 */
export const lineVisibility = (lines: { name: string; tram: boolean }[], hidden: string[]) => {
  const hiddenSet = new Set(hidden);
  const shownInGroup = new Map<LineGroup, number>();
  const listedInGroup = new Map<LineGroup, number>();
  for (const line of lines) {
    const group = lineGroup(line.name, line.tram);
    listedInGroup.set(group, (listedInGroup.get(group) ?? 0) + 1);
    if (!hiddenSet.has(line.name)) shownInGroup.set(group, (shownInGroup.get(group) ?? 0) + 1);
  }
  const hiddenGroups = new Set(
    [...listedInGroup.keys()].filter((group) => (listedInGroup.get(group) ?? 0) > 0 && !shownInGroup.get(group)),
  );
  return {
    /** Nothing is hidden: the map shows everything. */
    all: hiddenSet.size === 0,
    shownLines: lines.filter((line) => !hiddenSet.has(line.name)).map((line) => line.name),
    isShown: (line: string, tram: boolean) => !hiddenSet.has(line) && !hiddenGroups.has(lineGroup(line, tram)),
  };
};
