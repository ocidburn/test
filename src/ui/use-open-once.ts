import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useRef } from 'react';

/** Long enough for a modal to finish opening; the lock also lifts when the screen is back in focus. */
const LOCK_MS = 1_000;

/**
 * Opens a screen once per tap: a quick second tap, before the first modal
 * has covered the button, used to push the same screen twice.
 */
export const useOpenOnce = () => {
  const lockedAt = useRef(0);
  useFocusEffect(
    useCallback(() => {
      lockedAt.current = 0;
    }, []),
  );
  return useCallback((href: Href) => {
    const now = Date.now();
    if (now - lockedAt.current < LOCK_MS) return;
    lockedAt.current = now;
    router.push(href);
  }, []);
};
