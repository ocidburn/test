import { distanceMeters } from '../geo';
import type { LiveVehicle } from './types';

/**
 * How the other feeds compare with iMPK, kept as a log while iMPK runs.
 *
 * MPK's bus_position states no side number, so its vehicles are paired with
 * iMPK's by line and distance (nearest first, each used once, within
 * MATCH_METERS). Open Data states the side number, so it pairs exactly and
 * also shows how far behind its positions are.
 */

const MATCH_METERS = 400;
/** How many unmatched vehicles each entry names. */
const NAMED = 20;

export type SourceComparison = {
  /** Vehicles found in both. */
  matched: number;
  onlyImpk: number;
  onlyOther: number;
  medianMeters: number | null;
  p90Meters: number | null;
  /** How much older the other feed's positions are than iMPK's (Open Data). */
  medianLagSeconds: number | null;
  /** "line·number" of the unmatched, up to 20 each, to see what they are. */
  onlyImpkVehicles: string[];
  onlyOtherVehicles: string[];
};

export type ComparisonEntry = {
  at: number;
  counts: { impk: number; mpk: number | null; openData: number | null };
  mpk: SourceComparison | null;
  openData: SourceComparison | null;
};

const quantile = (values: number[], q: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};

type Pairing = { pairs: { meters: number; lagSeconds: number | null }[]; usedImpk: Set<number>; usedOther: Set<number> };

/** "18·3101"; MPK states no side number, so its own vehicle key stands in. */
const label = (vehicle: LiveVehicle) => `${vehicle.line}·${vehicle.vehicleNumber ?? vehicle.id.replace(/^[^:]*:(?:[^-]*-)?/, '')}`;

const unmatched = (vehicles: LiveVehicle[], used: Set<number>) =>
  vehicles
    .filter((_, i) => !used.has(i))
    .map(label)
    .sort((a, b) => a.localeCompare(b, 'pl', { numeric: true }))
    .slice(0, NAMED);

const summarise = ({ pairs, usedImpk, usedOther }: Pairing, impk: LiveVehicle[], other: LiveVehicle[], withLag: boolean): SourceComparison => {
  const lags = pairs.map((p) => p.lagSeconds).filter((v): v is number => v !== null);
  return {
    matched: pairs.length,
    onlyImpk: impk.length - pairs.length,
    onlyOther: other.length - pairs.length,
    medianMeters: quantile(pairs.map((p) => Math.round(p.meters)), 0.5),
    p90Meters: quantile(pairs.map((p) => Math.round(p.meters)), 0.9),
    medianLagSeconds: withLag ? quantile(lags, 0.5) : null,
    onlyImpkVehicles: unmatched(impk, usedImpk),
    onlyOtherVehicles: unmatched(other, usedOther),
  };
};

/** Pair by line and distance, nearest pairs first, each vehicle used once. */
const pairByDistance = (impk: LiveVehicle[], other: LiveVehicle[]): Pairing => {
  const candidates: { a: number; b: number; meters: number }[] = [];
  impk.forEach((a, i) =>
    other.forEach((b, j) => {
      if (a.line !== b.line) return;
      const meters = distanceMeters(a.lat, a.lon, b.lat, b.lon);
      if (meters <= MATCH_METERS) candidates.push({ a: i, b: j, meters });
    }),
  );
  candidates.sort((x, y) => x.meters - y.meters);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const pairs: { meters: number; lagSeconds: number | null }[] = [];
  for (const c of candidates) {
    if (usedA.has(c.a) || usedB.has(c.b)) continue;
    usedA.add(c.a);
    usedB.add(c.b);
    pairs.push({ meters: c.meters, lagSeconds: null });
  }
  return { pairs, usedImpk: usedA, usedOther: usedB };
};

const pairByNumber = (impk: LiveVehicle[], other: LiveVehicle[]): Pairing => {
  const byNumber = new Map<string, number>();
  impk.forEach((v, i) => v.vehicleNumber && byNumber.set(v.vehicleNumber, i));
  const pairs: { meters: number; lagSeconds: number | null }[] = [];
  const usedImpk = new Set<number>();
  const usedOther = new Set<number>();
  other.forEach((b, j) => {
    const i = b.vehicleNumber ? byNumber.get(b.vehicleNumber) : undefined;
    if (i === undefined || usedImpk.has(i)) return;
    const a = impk[i];
    usedImpk.add(i);
    usedOther.add(j);
    pairs.push({ meters: distanceMeters(a.lat, a.lon, b.lat, b.lon), lagSeconds: Math.round((a.positionAt - b.positionAt) / 1000) });
  });
  return { pairs, usedImpk, usedOther };
};

/** `null` for a source means it brought no new answer this round. */
export const compareSources = (
  at: number,
  impk: LiveVehicle[],
  mpk: LiveVehicle[] | null,
  openData: LiveVehicle[] | null,
): ComparisonEntry => ({
  at,
  counts: { impk: impk.length, mpk: mpk?.length ?? null, openData: openData?.length ?? null },
  mpk: mpk ? summarise(pairByDistance(impk, mpk), impk, mpk, false) : null,
  openData: openData ? summarise(pairByNumber(impk, openData), impk, openData, true) : null,
});

const fmtMeters = (m: number | null) => (m === null ? '—' : m < 1000 ? `${m} м` : `${(m / 1000).toFixed(1)} км`);
const fmtLag = (s: number | null) => (s === null ? '—' : Math.abs(s) < 120 ? `${s} с` : `${Math.round(s / 60)} мин`);

/** One side of an entry in words, for the Data screen and the shared log. */
export const describeComparison = (name: string, side: SourceComparison | null, count: number | null): string => {
  if (!side) return `${name}: в этот раз не опрашивался`;
  const parts = [
    `${name} ${count}: общих ${side.matched}, расхождение медиана ${fmtMeters(side.medianMeters)}, 90% до ${fmtMeters(side.p90Meters)}`,
    `только в iMPK ${side.onlyImpk}, только в ${name} ${side.onlyOther}`,
  ];
  if (side.medianLagSeconds !== null) parts.push(`отстаёт на ${fmtLag(side.medianLagSeconds)}`);
  return parts.join(' · ');
};

/** The unmatched vehicles of a side, for the shared log; empty when all matched. */
export const describeUnmatched = (name: string, side: SourceComparison | null): string[] => {
  if (!side) return [];
  const more = (shown: string[], total: number) => (total > shown.length ? `, … ещё ${total - shown.length}` : '');
  const lines: string[] = [];
  if (side.onlyImpk) lines.push(`только в iMPK (против ${name}): ${side.onlyImpkVehicles.join(', ')}${more(side.onlyImpkVehicles, side.onlyImpk)}`);
  if (side.onlyOther) lines.push(`только в ${name}: ${side.onlyOtherVehicles.join(', ')}${more(side.onlyOtherVehicles, side.onlyOther)}`);
  return lines;
};
