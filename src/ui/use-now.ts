import { useEffect, useState } from 'react';

/** The current time, re-read every `intervalMs` so countdowns and ages tick. */
export const useNow = (intervalMs: number) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
};
