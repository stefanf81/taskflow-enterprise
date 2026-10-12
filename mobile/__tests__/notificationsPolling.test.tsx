import React from 'react';
import { renderHook, act, cleanup } from '@testing-library/react-native';
import { QueryClientProvider, focusManager } from '@tanstack/react-query';

const mockGetNotifications = jest.fn();
jest.mock('../src/api/notifications', () => ({
  notificationsApi: { getNotifications: (...args: unknown[]) => mockGetNotifications(...args) },
}));

import { queryClient } from '../src/query/queryClient';
import { NOTIFICATIONS_POLL_MS, useNotifications } from '../src/hooks/useNotifications';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('notification polling lifecycle (MOB-10)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGetNotifications.mockReset();
    mockGetNotifications.mockResolvedValue([]);
    queryClient.clear();
    focusManager.setFocused(true);
  });

  afterEach(async () => {
    // Unmount first, then clear: otherwise removing the last observer re-arms
    // the 5-minute gc timer on the shared client and keeps Jest alive.
    await cleanup();
    queryClient.clear();
    jest.useRealTimers();
    focusManager.setFocused(undefined);
  });

  const tick = async (ms: number) => {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
  };

  it('polls every 15 s while the screen is focused and the app is active', async () => {
    await renderHook(() => useNotifications({ poll: true }), { wrapper });
    await tick(0);
    expect(mockGetNotifications).toHaveBeenCalledTimes(1);

    await tick(NOTIFICATIONS_POLL_MS);
    expect(mockGetNotifications).toHaveBeenCalledTimes(2);
    await tick(NOTIFICATIONS_POLL_MS);
    expect(mockGetNotifications).toHaveBeenCalledTimes(3);
  });

  it('does not poll when the screen is not focused', async () => {
    await renderHook(() => useNotifications({ poll: false }), { wrapper });
    await tick(0);
    expect(mockGetNotifications).toHaveBeenCalledTimes(1);

    await tick(NOTIFICATIONS_POLL_MS * 4);
    expect(mockGetNotifications).toHaveBeenCalledTimes(1);
  });

  it('stops polling while the app is backgrounded and resumes when it returns', async () => {
    await renderHook(() => useNotifications({ poll: true }), { wrapper });
    await tick(0);
    expect(mockGetNotifications).toHaveBeenCalledTimes(1);

    await act(async () => {
      focusManager.setFocused(false); // what the AppState listener does on 'background'
    });
    await tick(NOTIFICATIONS_POLL_MS * 3);
    expect(mockGetNotifications).toHaveBeenCalledTimes(1);

    await act(async () => {
      focusManager.setFocused(true);
    });
    await tick(NOTIFICATIONS_POLL_MS);
    expect(mockGetNotifications.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('defaults to polling when no option is given', async () => {
    await renderHook(() => useNotifications(), { wrapper });
    await tick(0);
    await tick(NOTIFICATIONS_POLL_MS);
    expect(mockGetNotifications).toHaveBeenCalledTimes(2);
  });
});

describe('queryClient focus wiring (MOB-10)', () => {
  it('mirrors AppState into TanStack focusManager', () => {
    let installListener: (handleFocus: (focused: boolean) => void) => () => void = () => () => {};
    let isolatedAppState: { addEventListener: jest.Mock };

    // Load queryClient.ts in a fresh module registry and capture what it
    // registers with focusManager.
    jest.isolateModules(() => {
      const { focusManager: isolatedFocusManager } = require('@tanstack/react-query');
      const spy = jest.spyOn(isolatedFocusManager, 'setEventListener');
      jest.doMock('react-native', () => ({ AppState: { addEventListener: jest.fn() } }));
      isolatedAppState = require('react-native').AppState;
      require('../src/query/queryClient');
      installListener = spy.mock.calls[0]?.[0] as typeof installListener;
    });

    const remove = jest.fn();
    isolatedAppState!.addEventListener.mockReset();
    isolatedAppState!.addEventListener.mockImplementation(() => ({ remove }));
    const handleFocus = jest.fn();
    const cleanup = installListener(handleFocus);

    expect(isolatedAppState!.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    const onChange = isolatedAppState!.addEventListener.mock.calls[0][1] as (s: string) => void;

    onChange('background');
    expect(handleFocus).toHaveBeenLastCalledWith(false);
    onChange('inactive');
    expect(handleFocus).toHaveBeenLastCalledWith(false);
    onChange('active');
    expect(handleFocus).toHaveBeenLastCalledWith(true);

    cleanup();
    expect(remove).toHaveBeenCalled();
  });
});
