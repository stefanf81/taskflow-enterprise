import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useNow } from '../src/core/shop/useNow';

/** Fake timers and Date, so the hook's interval and the clock are both under the test's control. */
describe('useNow', () => {
  let appStateListener: ((state: AppStateStatus) => void) | undefined;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-20T10:15:05Z') });
    appStateListener = undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      appStateListener = listener as (state: AppStateStatus) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  async function renderCounted(timeZone: string | null = 'UTC') {
    let renders = 0;
    const hook = await renderHook(() => {
      renders++;
      return useNow(60_000, timeZone);
    });
    return { ...hook, renders: () => renders };
  }

  it('renders once on mount, not again for the same minute', async () => {
    // Each check returned a new clock object, so every caller rendered twice on mount and again
    // on every return to the app (BENCHMARKS.md §79).
    const { result, renders } = await renderCounted();

    expect(renders()).toBe(1);
    expect(result.current.getMinutes()).toBe(15);
  });

  it('re-renders on a return to the app only when the minute has changed', async () => {
    const { result, renders } = await renderCounted();

    jest.setSystemTime(new Date('2026-11-20T10:15:40Z'));
    await act(async () => appStateListener?.('active'));
    expect(renders()).toBe(1);

    jest.setSystemTime(new Date('2026-11-20T10:16:01Z'));
    await act(async () => appStateListener?.('active'));
    expect(renders()).toBe(2);
    expect(result.current.getMinutes()).toBe(16);
  });

  it('follows the clock every interval', async () => {
    const { result } = await renderCounted();

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(result.current.getMinutes()).toBe(16);
  });

  it('moves to the shop’s zone once it is known', async () => {
    const { result, rerender } = await renderHook(
      ({ zone }: { zone: string | null }) => useNow(60_000, zone),
      { initialProps: { zone: null as string | null } },
    );

    await rerender({ zone: 'Asia/Kolkata' }); // UTC+05:30
    expect([result.current.getHours(), result.current.getMinutes()]).toEqual([15, 45]);
  });
});
