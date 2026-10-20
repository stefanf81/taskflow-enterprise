import { onlineManager, QueryObserver } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { queryClient } from '../src/query/queryClient';

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
  getNetworkStateAsync: jest.fn(() => Promise.resolve({ isConnected: false })),
}));

type NetworkListener = (state: { isConnected?: boolean }) => void;

const addListener = Network.addNetworkStateListener as jest.Mock;
const emit: NetworkListener = (state) => (addListener.mock.calls[0]![0] as NetworkListener)(state);
const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe('onlineManager (expo-network)', () => {
  it('starts from the connectivity the device reports at startup', async () => {
    await flushPromises();

    expect(addListener).toHaveBeenCalledTimes(1);
    expect(onlineManager.isOnline()).toBe(false);
  });

  it('follows connectivity changes and treats an unknown state as online', () => {
    emit({ isConnected: true });
    expect(onlineManager.isOnline()).toBe(true);

    emit({ isConnected: false });
    expect(onlineManager.isOnline()).toBe(false);

    emit({});
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('refetches a query that failed offline once the device reconnects', async () => {
    queryClient.mount();
    const queryFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValue(['Classic Haircut']);
    emit({ isConnected: false });

    const observer = new QueryObserver(queryClient, {
      queryKey: ['reconnect-test'],
      queryFn,
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => undefined);

    try {
      // networkMode 'always': the offline attempt runs and fails, so screens show their
      // error state instead of a query that stays pending.
      await flushPromises();
      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(observer.getCurrentResult().status).toBe('error');

      emit({ isConnected: true });
      await flushPromises();
      await flushPromises();

      expect(queryFn).toHaveBeenCalledTimes(2);
      expect(observer.getCurrentResult().data).toEqual(['Classic Haircut']);
    } finally {
      unsubscribe();
      queryClient.unmount();
      queryClient.clear();
    }
  });

  it('lets the startup read lose to an event that arrived first', async () => {
    let resolveInitial: (state: { isConnected: boolean }) => void = () => undefined;
    await jest.isolateModulesAsync(async () => {
      const network = jest.requireMock('expo-network') as {
        addNetworkStateListener: jest.Mock;
        getNetworkStateAsync: jest.Mock;
      };
      network.getNetworkStateAsync.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveInitial = resolve;
        }),
      );
      const isolated = jest.requireActual('@tanstack/react-query') as typeof import('@tanstack/react-query');
      require('../src/query/queryClient');

      const listener = network.addNetworkStateListener.mock.calls.at(-1)![0] as NetworkListener;
      listener({ isConnected: true });
      resolveInitial({ isConnected: false });
      await flushPromises();

      expect(isolated.onlineManager.isOnline()).toBe(true);
    });
  });

  it('stays online when the startup read fails', async () => {
    await jest.isolateModulesAsync(async () => {
      const network = jest.requireMock('expo-network') as { getNetworkStateAsync: jest.Mock };
      network.getNetworkStateAsync.mockReturnValueOnce(Promise.reject(new Error('unavailable')));
      const isolated = jest.requireActual('@tanstack/react-query') as typeof import('@tanstack/react-query');
      require('../src/query/queryClient');
      await flushPromises();

      expect(isolated.onlineManager.isOnline()).toBe(true);
    });
  });

  it('removes the expo-network subscription when the listener is replaced', () => {
    const subscription = addListener.mock.results[0]!.value as { remove: jest.Mock };

    onlineManager.setEventListener(() => undefined);

    expect(subscription.remove).toHaveBeenCalledTimes(1);
  });
});
