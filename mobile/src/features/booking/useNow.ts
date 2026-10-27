import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { shopWallClock } from '../../utils/time-utils';

/**
 * Current time on the shop's wall clock (see `shopWallClock`; the phone's own clock while the
 * shop's time zone is unknown). Re-renders the caller every `intervalMs`, when the zone becomes
 * known, and when the app returns to the foreground (timers are suspended in the background, so
 * the value would otherwise be stale after a long pause or a midnight rollover).
 */
export function useNow(intervalMs = 60_000, timeZone: string | null = null): Date {
  const [now, setNow] = useState(() => shopWallClock(timeZone));

  useEffect(() => {
    const tick = () => setNow(shopWallClock(timeZone));
    tick();
    const timer = setInterval(tick, intervalMs);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [intervalMs, timeZone]);

  return now;
}
