import { ClientTelemetry, TelemetryRoute } from './client-telemetry';

interface LayoutShift extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

/**
 * Native observers only: no resource entries, DOM attribution, URLs or performance marks.
 * FCP, LCP and CLS describe the page load, so they are attributed to `initialRoute` (the first
 * completed navigation) rather than to wherever the user is when the values are final: FCP is
 * sent once that route is known, LCP and the session-window CLS at the first page hide.
 * INP is intentionally NOT approximated from arbitrary event durations.
 */
export function observeWebVitals(
  telemetry: ClientTelemetry,
  initialRoute: Promise<TelemetryRoute>,
  currentRoute: () => TelemetryRoute,
): () => void {
  if (
    !telemetry.active ||
    typeof PerformanceObserver === 'undefined' ||
    typeof document === 'undefined'
  )
    return () => undefined;
  let route: TelemetryRoute | undefined;
  void initialRoute.then(
    (resolved) => (route = resolved),
    () => undefined,
  );
  // Hidden before the first navigation ended: the current page is the best guess.
  const loadRoute = () => route ?? currentRoute();
  const observers: PerformanceObserver[] = [];
  let lcp: number | undefined;
  let cls = 0;
  let windowValue = 0;
  let firstShift = 0;
  let lastShift = 0;
  let fcpSent = false;
  let finished = false;
  const observe = (type: string, process: (entries: PerformanceEntry[]) => void) => {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) return;
    const observer = new PerformanceObserver((list) => process(list.getEntries()));
    try {
      observer.observe({ type, buffered: true });
      observers.push(observer);
    } catch {
      observer.disconnect();
    }
  };
  observe('paint', (entries) => {
    for (const entry of entries) {
      if (entry.name === 'first-contentful-paint' && !fcpSent) {
        fcpSent = true;
        const value = entry.startTime;
        void initialRoute.then(
          (resolved) => telemetry.performance('FCP', resolved, value),
          () => telemetry.performance('FCP', currentRoute(), value),
        );
      }
    }
  });
  observe('largest-contentful-paint', (entries) => {
    for (const entry of entries) lcp = entry.startTime;
  });
  const measuresLayoutShift = PerformanceObserver.supportedEntryTypes.includes('layout-shift');
  observe('layout-shift', (entries) => {
    for (const raw of entries) {
      const entry = raw as LayoutShift;
      if (entry.hadRecentInput) continue;
      if (
        windowValue > 0 &&
        entry.startTime - lastShift < 1000 &&
        entry.startTime - firstShift < 5000
      ) {
        windowValue += entry.value;
      } else {
        firstShift = entry.startTime;
        windowValue = entry.value;
      }
      lastShift = entry.startTime;
      cls = Math.max(cls, windowValue);
    }
  });
  const cleanup = () => {
    observers.forEach((observer) => observer.disconnect());
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('pagehide', finish);
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
    // Both are final at the first hide; neither transport may hold up navigation (keepalive).
    if (lcp !== undefined) telemetry.performance('LCP', loadRoute(), lcp);
    if (measuresLayoutShift) telemetry.performance('CLS', loadRoute(), cls);
  };
  const onHidden = () => {
    if (document.visibilityState === 'hidden') finish();
  };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', finish, { once: true });
  return cleanup;
}
