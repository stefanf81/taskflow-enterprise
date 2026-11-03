import { act, renderHook } from '@testing-library/react-native';
import { FLASH_DURATION_MS, useFlashMessage } from '../src/components/common/useFlashMessage';

describe('useFlashMessage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('shows a message and dismisses it after the duration', async () => {
    const { result } = await renderHook(() => useFlashMessage());
    await act(async () => result.current.showSuccess('Saved.'));
    expect(result.current.successMessage).toBe('Saved.');

    await act(async () => jest.advanceTimersByTime(FLASH_DURATION_MS - 1));
    expect(result.current.successMessage).toBe('Saved.');
    await act(async () => jest.advanceTimersByTime(1));
    expect(result.current.successMessage).toBeNull();
  });

  it('restarts the timer when a message replaces the previous one', async () => {
    const { result } = await renderHook(() => useFlashMessage(1000));
    await act(async () => result.current.showError('First'));
    await act(async () => jest.advanceTimersByTime(800));
    await act(async () => result.current.showError('Second'));
    await act(async () => jest.advanceTimersByTime(800));
    expect(result.current.errorMessage).toBe('Second');
    await act(async () => jest.advanceTimersByTime(200));
    expect(result.current.errorMessage).toBeNull();
  });

  it('times success and error out independently', async () => {
    // A shared timer let a later error cancel the success banner's dismissal.
    const { result } = await renderHook(() => useFlashMessage(1000));
    await act(async () => result.current.showSuccess('Approved.'));
    await act(async () => jest.advanceTimersByTime(500));
    await act(async () => result.current.showError('Delete failed.'));
    await act(async () => jest.advanceTimersByTime(500));
    expect(result.current.successMessage).toBeNull();
    expect(result.current.errorMessage).toBe('Delete failed.');
    await act(async () => jest.advanceTimersByTime(500));
    expect(result.current.errorMessage).toBeNull();
  });

  // Ids of the timers the hook started (other timers belong to React Native and the renderer).
  const flashTimers = (setSpy: jest.SpyInstance, durationMs: number) =>
    setSpy.mock.calls.flatMap((call, i) =>
      call[1] === durationMs ? [setSpy.mock.results[i]?.value] : [],
    );

  it('dismisses at once and cancels the pending timer', async () => {
    const setSpy = jest.spyOn(global, 'setTimeout');
    const clearSpy = jest.spyOn(global, 'clearTimeout');
    const { result } = await renderHook(() => useFlashMessage());
    await act(async () => result.current.showSuccess('Saved.'));
    const [timer] = flashTimers(setSpy, FLASH_DURATION_MS);
    await act(async () => result.current.dismissSuccess());
    expect(result.current.successMessage).toBeNull();
    expect(clearSpy).toHaveBeenCalledWith(timer);
  });

  it('clears pending timers on unmount', async () => {
    const setSpy = jest.spyOn(global, 'setTimeout');
    const clearSpy = jest.spyOn(global, 'clearTimeout');
    const { result, unmount } = await renderHook(() => useFlashMessage());
    await act(async () => {
      result.current.showSuccess('Saved.');
      result.current.showError('Failed.');
    });
    const timers = flashTimers(setSpy, FLASH_DURATION_MS);
    expect(timers).toHaveLength(2);
    expect(clearSpy).not.toHaveBeenCalledWith(timers[0]);
    await unmount();
    timers.forEach((timer) => expect(clearSpy).toHaveBeenCalledWith(timer));
  });
});
