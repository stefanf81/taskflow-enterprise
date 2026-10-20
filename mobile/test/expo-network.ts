// query/queryClient.ts subscribes TanStack's onlineManager to expo-network at import. jest-expo's
// native stub returns no subscription (so the cleanup would throw) and loading the real module
// pulls in expo's runtime; every suite gets an online device instead. __tests__/onlineManager
// replaces this with its own mock to drive connectivity changes.
jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
  getNetworkStateAsync: jest.fn(() => Promise.resolve({ isConnected: true })),
}));
