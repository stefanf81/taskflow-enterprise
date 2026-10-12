/**
 * Freeze ONLY `Date` (timers stay real) so wall-clock dependent UI — past-slot
 * filtering, "today" defaults — is deterministic without making async
 * Testing Library utilities hang.
 */
export function freezeDate(iso: string): void {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

export function moveClockTo(iso: string): void {
  jest.setSystemTime(new Date(iso));
}

export function restoreClock(): void {
  jest.useRealTimers();
}
