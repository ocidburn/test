import { isInForce, type FeedWindow } from './archive';
import type { FeedCandidate } from './catalogue';
import { inspectArchive } from './importer';
import { looksLikeZip } from './zip';
import { warsawDateKey } from '../time/warsaw';

/** What earlier checks learned about a snapshot URL, so it is not downloaded again for nothing. */
export type KnownSnapshot = { window: FeedWindow | null } | { invalid: string };

export type UpdateDecision =
  | { action: 'keep'; known: Record<string, KnownSnapshot>; reason: string }
  | {
      action: 'import';
      candidate: FeedCandidate;
      bytes: Uint8Array;
      window: FeedWindow | null;
      known: Record<string, KnownSnapshot>;
      reason: string;
    };

/**
 * Pick the snapshot to import, if any.
 *
 * Candidates arrive best first. Reaching the one already installed means
 * nothing better exists. A future-dated snapshot is remembered and skipped
 * until its start date; one that failed validation (no shapes.txt, not a
 * zip) is remembered and never downloaded again. When nothing is in force,
 * a valid future snapshot is used only if there is no timetable at all —
 * a stale timetable beats none, but an early one beats nothing only then.
 */
export const decideUpdate = async ({
  candidates,
  download,
  currentUrl,
  known: knownIn,
  now = Date.now(),
  maxDownloads = 4,
  log = () => {},
}: {
  candidates: FeedCandidate[];
  download: (url: string) => Promise<Uint8Array>;
  currentUrl: string | null;
  known: Record<string, KnownSnapshot>;
  now?: number;
  maxDownloads?: number;
  log?: (message: string) => void;
}): Promise<UpdateDecision> => {
  const known = { ...knownIn };
  const today = warsawDateKey(now);
  let fallback: Extract<UpdateDecision, { action: 'import' }> | null = null;
  let downloads = 0;

  for (const candidate of candidates) {
    if (candidate.url === currentUrl) {
      return { action: 'keep', known, reason: 'installed timetable is the best available' };
    }
    const memo = known[candidate.url];
    if (memo && 'invalid' in memo) continue;
    if (memo && memo.window && memo.window.start > today) continue;
    if (downloads >= maxDownloads) break;

    downloads += 1;
    let bytes: Uint8Array;
    try {
      bytes = await download(candidate.url);
    } catch (error) {
      log(`download failed ${candidate.url}: ${(error as Error).message}`);
      continue;
    }

    // An HTML error page or a truncated transfer says nothing about the
    // snapshot itself, so it is retried next time rather than remembered.
    if (!looksLikeZip(bytes)) {
      log(`${candidate.url} did not return a zip archive (${bytes.length} bytes)`);
      continue;
    }

    let window: FeedWindow | null;
    try {
      window = inspectArchive(bytes).window;
    } catch (error) {
      const reason = (error as Error).message;
      log(`rejected ${candidate.url}: ${reason}`);
      known[candidate.url] = { invalid: reason };
      continue;
    }
    known[candidate.url] = { window };

    if (isInForce(window, now)) {
      return { action: 'import', candidate, bytes, window, known, reason: 'snapshot in force' };
    }
    log(`${candidate.url} is valid from ${window?.start} to ${window?.end}, not today`);
    fallback ??= { action: 'import', candidate, bytes, window, known, reason: 'no snapshot in force; using nearest valid one' };
  }

  if (!currentUrl && fallback) return { ...fallback, known };
  return { action: 'keep', known, reason: currentUrl ? 'no better snapshot found' : 'no usable snapshot found' };
};
