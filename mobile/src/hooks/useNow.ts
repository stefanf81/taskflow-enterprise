import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Current time that re-renders the caller every `intervalMs` and when the app
 * returns to the foreground (timers are suspended in the background, so the
 * value would otherwise be stale after a long pause or a midnight rollover).
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = setInterval(tick, intervalMs);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [intervalMs]);

  return now;
}
