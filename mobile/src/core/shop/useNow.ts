import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { type WallClock, shopWallClock } from '../../utils/time-utils';

/** Same date, hour and minute: every caller reads the clock at minute resolution. */
function sameMinute(a: WallClock, b: WallClock): boolean {
  return (
    a.getMinutes() === b.getMinutes() &&
    a.getHours() === b.getHours() &&
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
  );
}

/**
 * Current time on the shop's wall clock (see `shopWallClock`; the phone's own clock while the
 * shop's time zone is unknown), to the minute. Checked every `intervalMs`, when the zone becomes
 * known, and when the app returns to the foreground (timers are suspended in the background, so
 * the value would otherwise be stale after a long pause or a midnight rollover). The caller
 * re-renders only when the minute it shows has changed: each check used to return a new object,
 * so every caller rendered twice on mount and again on each return to the app (BENCHMARKS.md §79).
 */
export function useNow(intervalMs = 60_000, timeZone: string | null = null): WallClock {
  const [now, setNow] = useState(() => shopWallClock(timeZone));

  useEffect(() => {
    const tick = () => {
      const next = shopWallClock(timeZone);
      setNow((current) => (sameMinute(current, next) ? current : next));
    };
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
