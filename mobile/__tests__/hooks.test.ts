import { renderHook, act } from '@testing-library/react-native';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ============================================================
// Mocks for all API modules — use const + closure references
// which is safe: factory only references the variable at
// call-time (when the hook runs), not at factory creation time.
// ============================================================
const mockGetAllAppointmentsFn = jest.fn();
const mockGetBusySlotsFn = jest.fn();
const mockCreateAppointmentFn = jest.fn();
const mockUpdateAppointmentStatusFn = jest.fn();
const mockDeleteAppointmentFn = jest.fn();
const mockPublicCancelAppointmentFn = jest.fn();
const mockGetShopInfoFn = jest.fn();

jest.mock('../src/core/appointments/appointments', () => ({
  appointmentsApi: {
    getAllAppointments: (...args: unknown[]) => mockGetAllAppointmentsFn(...args),
    getBusySlots: (...args: unknown[]) => mockGetBusySlotsFn(...args),
    createAppointment: (...args: unknown[]) => mockCreateAppointmentFn(...args),
    updateAppointmentStatus: (...args: unknown[]) => mockUpdateAppointmentStatusFn(...args),
    deleteAppointment: (...args: unknown[]) => mockDeleteAppointmentFn(...args),
    publicCancelAppointment: (...args: unknown[]) => mockPublicCancelAppointmentFn(...args),
    getShopInfo: (...args: unknown[]) => mockGetShopInfoFn(...args),
  },
}));

const mockGetPublicBarbersFn = jest.fn();
const mockGetAdminBarbersFn = jest.fn();
const mockGetTimeOffFn = jest.fn();
const mockAddTimeOffFn = jest.fn();

jest.mock('../src/core/barbers/barbers', () => ({
  barbersApi: {
    getPublicBarbers: (...args: unknown[]) => mockGetPublicBarbersFn(...args),
    getAdminBarbers: (...args: unknown[]) => mockGetAdminBarbersFn(...args),
    getTimeOff: (...args: unknown[]) => mockGetTimeOffFn(...args),
    addTimeOff: (...args: unknown[]) => mockAddTimeOffFn(...args),
  },
}));

const mockGetAllServicesFn = jest.fn();
const mockGetRetiredServicesFn = jest.fn();
const mockRestoreServiceFn = jest.fn();
jest.mock('../src/core/catalog/catalog', () => ({
  catalogApi: {
    getAllServices: (...args: unknown[]) => mockGetAllServicesFn(...args),
    getRetiredServices: (...args: unknown[]) => mockGetRetiredServicesFn(...args),
    restoreService: (...args: unknown[]) => mockRestoreServiceFn(...args),
  },
}));

const mockCustomerGetAppointmentsFn = jest.fn();
const mockCustomerCancelAppointmentFn = jest.fn();
jest.mock('../src/features/customer/customer', () => ({
  customerApi: {
    getAppointments: (...args: unknown[]) => mockCustomerGetAppointmentsFn(...args),
    cancelAppointment: (...args: unknown[]) => mockCustomerCancelAppointmentFn(...args),
  },
}));

const mockGetNotificationsFn = jest.fn();
jest.mock('../src/features/admin/notifications', () => ({
  notificationsApi: {
    getNotifications: (...args: unknown[]) => mockGetNotificationsFn(...args),
  },
}));

const mockGetBarberRatingsFn = jest.fn();
const mockSubmitReviewFn = jest.fn();
jest.mock('../src/features/landing/reviews', () => ({
  reviewsApi: {
    getBarberRatings: (...args: unknown[]) => mockGetBarberRatingsFn(...args),
    submitReview: (...args: unknown[]) => mockSubmitReviewFn(...args),
  },
}));

// ============================================================
// Test wrapper with QueryClient
// ============================================================
const queryClients = new Set<QueryClient>();
let lastQueryClient: QueryClient | null = null;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  queryClients.add(queryClient);
  lastQueryClient = queryClient;
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

import { useAppointments, useBusySlots, useCreateAppointment, useUpdateAppointmentStatus, useDeleteAppointment, usePublicCancelAppointment } from '../src/core/appointments/useAppointments';
import { useShopInfo } from '../src/core/shop/useShopInfo';
import { DEFAULT_SHOP_RULES } from '@taskflow/domain';
import { usePublicBarbers, useAdminBarbers, useBarberTimeOff, useAddTimeOff } from '../src/core/barbers/useBarbers';
import { useCatalog, useRestoreService, useRetiredServices } from '../src/core/catalog/useCatalog';
import { useCustomerAppointments, useCancelCustomerAppointment } from '../src/features/customer/useCustomer';
import { useNotifications } from '../src/features/admin/useNotifications';
import { useBarberRatings, useSubmitReview } from '../src/features/landing/useReviews';

describe('Hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    queryClients.forEach((queryClient) => queryClient.clear());
    queryClients.clear();
    lastQueryClient = null;
  });

  // ==================== APPOINTMENTS ====================
  describe('useAppointments', () => {
    it('fetches appointments with given params', async () => {
      const mockData = {
        page: { content: [], page: { number: 0, size: 10, totalElements: 0, totalPages: 0 } },
        stats: null,
      };
      mockGetAllAppointmentsFn.mockResolvedValueOnce(mockData);

      const { result } = await renderHook(() => useAppointments('pending', 'Alex', 0, 10), {
        wrapper: createWrapper(),
      });

      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      expect(mockGetAllAppointmentsFn).toHaveBeenCalledWith('pending', 'Alex', 0, 10, { signal: expect.any(AbortSignal) });
      expect(result.current.data).toBeDefined();
    });

    it('keeps the previous page on screen while the next one loads', async () => {
      const firstPage = {
        page: { content: [], page: { number: 0, size: 10, totalElements: 20, totalPages: 2 } },
        stats: null,
      };
      mockGetAllAppointmentsFn
        .mockResolvedValueOnce(firstPage)
        .mockReturnValueOnce(new Promise(() => undefined));

      const { result, rerender } = await renderHook(
        ({ page }: { page: number }) => useAppointments('all', '', page, 10),
        { wrapper: createWrapper(), initialProps: { page: 0 } },
      );
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(result.current.data).toEqual(firstPage);

      await rerender({ page: 1 });

      expect(result.current.isPlaceholderData).toBe(true);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.data).toEqual(firstPage);
    });

    it('aborts the request when the screen unmounts before it finishes', async () => {
      let signal: AbortSignal | undefined;
      mockGetAllAppointmentsFn.mockImplementationOnce(
        (_filter, _search, _page, _size, options: { signal: AbortSignal }) => {
          signal = options.signal;
          return new Promise(() => undefined);
        },
      );

      const { unmount } = await renderHook(() => useAppointments('all', '', 0, 10), {
        wrapper: createWrapper(),
      });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      expect(signal?.aborted).toBe(false);

      await unmount();

      expect(signal?.aborted).toBe(true);
    });

    it('opts volatile data into refetching when the app returns to the foreground', async () => {
      mockGetAllAppointmentsFn.mockResolvedValue({
        page: { content: [], page: { number: 0, size: 10, totalElements: 0, totalPages: 0 } },
        stats: null,
      });
      mockGetBusySlotsFn.mockResolvedValue([]);
      mockCustomerGetAppointmentsFn.mockResolvedValue({
        content: [], page: { number: 0, size: 10, totalElements: 0, totalPages: 0 },
      });
      mockGetAllServicesFn.mockResolvedValue([]);
      const wrapper = createWrapper();
      await renderHook(() => useAppointments('all', '', 0, 10), { wrapper });
      await renderHook(() => useBusySlots('Alex', '2026-08-01'), { wrapper });
      await renderHook(() => useCustomerAppointments(0, 10), { wrapper });
      await renderHook(() => useCatalog(), { wrapper });
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      const focusRefetch = (queryKey: unknown[]) =>
        lastQueryClient!.getQueryCache().find({ queryKey, exact: false })?.observers[0]?.options
          .refetchOnWindowFocus;
      expect(focusRefetch(['appointments'])).toBe(true);
      expect(focusRefetch(['busySlots'])).toBe(true);
      expect(focusRefetch(['customerAppointments'])).toBe(true);
      // Reference data keeps the global default (off).
      expect(focusRefetch(['catalog'])).toBeUndefined();
    });
  });

  describe('useShopInfo', () => {
    const openingHours = [{ dayOfWeek: 2, opens: '10:00', closes: '18:00' }];

    it('uses the server defaults until the shop info is known, then the server values', async () => {
      // Held until the loading state has been checked: an already-resolved answer can reach the
      // hook during renderHook's own act on a slow runner (CI run 43601061448).
      let answer!: (info: unknown) => void;
      mockGetShopInfoFn.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));

      const { result } = await renderHook(() => useShopInfo(), { wrapper: createWrapper() });
      expect(result.current).toEqual({ timeZone: null, rules: DEFAULT_SHOP_RULES, loaded: false });

      await act(async () => {
        answer({ timeZone: 'Europe/Berlin', maxAdvanceDays: 30, openingHours });
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(result.current).toEqual({
        timeZone: 'Europe/Berlin',
        rules: { maxAdvanceDays: 30, openingHours },
        loaded: true,
      });
    });

    it('keeps the phone clock and the defaults when the shop info cannot be loaded', async () => {
      mockGetShopInfoFn.mockRejectedValue(new Error('offline'));

      const { result } = await renderHook(() => useShopInfo(), { wrapper: createWrapper() });
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      expect(result.current).toEqual({ timeZone: null, rules: DEFAULT_SHOP_RULES, loaded: false });
    });
  });

  describe('useBusySlots', () => {
    it('fetches busy slots when barber and date are provided', async () => {
      mockGetBusySlotsFn.mockResolvedValueOnce(['10:00']);

      await renderHook(() => useBusySlots('Alex', '2026-08-01'), { wrapper: createWrapper() });

      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      expect(mockGetBusySlotsFn).toHaveBeenCalledWith('Alex', '2026-08-01', undefined, { signal: expect.any(AbortSignal) });
    });

    it('does not fetch when barberName is empty', async () => {
      await renderHook(() => useBusySlots('', '2026-08-01'), { wrapper: createWrapper() });

      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      expect(mockGetBusySlotsFn).not.toHaveBeenCalled();
    });

    it('stays idle while the caller disables it, and fetches once enabled', async () => {
      mockGetBusySlotsFn.mockResolvedValue(['10:00']);
      const { rerender } = await renderHook(
        ({ enabled }: { enabled: boolean }) =>
          useBusySlots('Alex', '2026-08-01', 'Classic Haircut', { enabled }),
        { wrapper: createWrapper(), initialProps: { enabled: false } },
      );

      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(mockGetBusySlotsFn).not.toHaveBeenCalled();

      await rerender({ enabled: true });
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(mockGetBusySlotsFn).toHaveBeenCalledWith('Alex', '2026-08-01', 'Classic Haircut', { signal: expect.any(AbortSignal) });
    });
  });

  describe('useCreateAppointment', () => {
    it('creates appointment', async () => {
      mockCreateAppointmentFn.mockResolvedValueOnce({ id: 1 });

      const { result } = await renderHook(() => useCreateAppointment(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync({
          data: {
            customerName: 'John', customerEmail: 'j@ex.com', customerPhone: '+1',
            barberName: 'Alex', bookingDate: '2026-08-01', bookingTime: '10:00', serviceType: 'Haircut',
          },
          idempotencyKey: 'attempt-key-1',
        });
      });

      expect(mockCreateAppointmentFn).toHaveBeenCalledWith(
        expect.objectContaining({ customerName: 'John' }),
        'attempt-key-1',
      );
    });

    it("refreshes the signed-in customer's bookings, not only the admin list and the slots", async () => {
      mockCreateAppointmentFn.mockResolvedValueOnce({ id: 1 });
      const { result } = await renderHook(() => useCreateAppointment(), { wrapper: createWrapper() });
      const invalidateQueries = jest.spyOn(lastQueryClient!, 'invalidateQueries');

      await act(async () => {
        await result.current.mutateAsync({
          data: {
            customerName: 'John', customerEmail: 'j@ex.com', customerPhone: '+1',
            barberName: 'Alex', bookingDate: '2026-08-01', bookingTime: '10:00', serviceType: 'Haircut',
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customerAppointments'] });
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['appointments'] });
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['busySlots'] });
    });
  });

  describe('useUpdateAppointmentStatus', () => {
    it('updates status', async () => {
      mockUpdateAppointmentStatusFn.mockResolvedValueOnce({ id: 1, status: 'APPROVED' });

      const { result } = await renderHook(() => useUpdateAppointmentStatus(), { wrapper: createWrapper() });
      const invalidateQueries = jest.spyOn(lastQueryClient!, 'invalidateQueries');

      await act(async () => {
        await result.current.mutateAsync({ id: 1, status: 'APPROVED' });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(mockUpdateAppointmentStatusFn).toHaveBeenCalledWith(1, 'APPROVED');
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['busySlots'] });
    });
  });

  describe('useDeleteAppointment', () => {
    it('deletes appointment', async () => {
      mockDeleteAppointmentFn.mockResolvedValueOnce(undefined);

      const { result } = await renderHook(() => useDeleteAppointment(), { wrapper: createWrapper() });
      const invalidateQueries = jest.spyOn(lastQueryClient!, 'invalidateQueries');

      await act(async () => {
        await result.current.mutateAsync(5);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(mockDeleteAppointmentFn).toHaveBeenCalledWith(5);
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['busySlots'] });
    });
  });

  describe('usePublicCancelAppointment', () => {
    it('calls public cancel API', async () => {
      mockPublicCancelAppointmentFn.mockResolvedValueOnce(undefined);

      const { result } = await renderHook(() => usePublicCancelAppointment(), { wrapper: createWrapper() });
      const invalidateQueries = jest.spyOn(lastQueryClient!, 'invalidateQueries');

      await act(async () => {
        await result.current.mutateAsync({ publicId: 'TF-0001', email: 'j@ex.com' });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['busySlots'] });

      expect(mockPublicCancelAppointmentFn).toHaveBeenCalledWith('TF-0001', 'j@ex.com');
    });
  });

  // ==================== BARBERS ====================
  describe('barber queries', () => {
    it('fetches public barbers', async () => {
      mockGetPublicBarbersFn.mockResolvedValueOnce([{ id: 1, name: 'Alex' }]);

      await renderHook(() => usePublicBarbers(), { wrapper: createWrapper() });

      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      expect(mockGetPublicBarbersFn).toHaveBeenCalled();
    });

    it('fetches administrative barbers separately', async () => {
      mockGetAdminBarbersFn.mockResolvedValueOnce([{ id: 1, name: 'Alex', email: '', phone: '' }]);

      await renderHook(() => useAdminBarbers(), { wrapper: createWrapper() });

      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      expect(mockGetAdminBarbersFn).toHaveBeenCalled();
    });
  });

  describe('useBarberTimeOff', () => {
    it('fetches time-off when barberId is provided', async () => {
      mockGetTimeOffFn.mockResolvedValueOnce([]);

      await renderHook(() => useBarberTimeOff(1), { wrapper: createWrapper() });

      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      expect(mockGetTimeOffFn).toHaveBeenCalledWith(1, { signal: expect.any(AbortSignal) });
    });

    it('does not fetch when barberId is null', async () => {
      await renderHook(() => useBarberTimeOff(null), { wrapper: createWrapper() });
      expect(mockGetTimeOffFn).not.toHaveBeenCalled();
    });
  });

  describe('useAddTimeOff', () => {
    it('adds time-off', async () => {
      mockAddTimeOffFn.mockResolvedValueOnce({ id: 1, startDate: '2026-08-01', endDate: '2026-08-02', reason: 'Vacation' });

      const { result } = await renderHook(() => useAddTimeOff(), { wrapper: createWrapper() });
      const invalidateQueries = jest.spyOn(lastQueryClient!, 'invalidateQueries');

      await act(async () => {
        await result.current.mutateAsync({ barberId: 1, data: { startDate: '2026-08-01', endDate: '2026-08-02', reason: 'Vacation' } });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(mockAddTimeOffFn).toHaveBeenCalledWith(1, { startDate: '2026-08-01', endDate: '2026-08-02', reason: 'Vacation' });
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['busySlots'] });
    });
  });

  // ==================== CATALOG ====================
  describe('useCatalog', () => {
    it('fetches all services', async () => {
      mockGetAllServicesFn.mockResolvedValueOnce([{ id: 1, name: 'Haircut', price: 45, durationMinutes: 30, category: 'hair', description: '' }]);

      await renderHook(() => useCatalog(), { wrapper: createWrapper() });

      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      expect(mockGetAllServicesFn).toHaveBeenCalled();
    });
  });

  describe('retired services', () => {
    it('stays idle until enabled, then fetches the retired list', async () => {
      mockGetRetiredServicesFn.mockResolvedValue([]);

      const { rerender } = await renderHook(
        ({ enabled }: { enabled: boolean }) => useRetiredServices({ enabled }),
        { wrapper: createWrapper(), initialProps: { enabled: false } },
      );
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(mockGetRetiredServicesFn).not.toHaveBeenCalled();

      await rerender({ enabled: true });
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(mockGetRetiredServicesFn).toHaveBeenCalledTimes(1);
    });

    it('restoring refreshes the public menu and the retired list', async () => {
      mockRestoreServiceFn.mockResolvedValueOnce({ id: 7, name: 'Old Fade' });

      const { result } = await renderHook(() => useRestoreService(), { wrapper: createWrapper() });
      const invalidateQueries = jest.spyOn(lastQueryClient!, 'invalidateQueries');

      await act(async () => {
        await result.current.mutateAsync(7);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(mockRestoreServiceFn).toHaveBeenCalledWith(7);
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['catalog'] });
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['retiredServices'] });
    });
  });

  // ==================== CUSTOMER ====================
  describe('useCustomerAppointments', () => {
    it('fetches customer appointments', async () => {
      mockCustomerGetAppointmentsFn.mockResolvedValueOnce({
        content: [], page: { number: 0, size: 10, totalElements: 0, totalPages: 0 },
      });

      await renderHook(() => useCustomerAppointments(0, 10), { wrapper: createWrapper() });

      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      expect(mockCustomerGetAppointmentsFn).toHaveBeenCalledWith(0, 10, { signal: expect.any(AbortSignal) });
    });
  });

  describe('useCancelCustomerAppointment', () => {
    it('cancels customer appointment', async () => {
      mockCustomerCancelAppointmentFn.mockResolvedValueOnce(undefined);

      const { result } = await renderHook(() => useCancelCustomerAppointment(), { wrapper: createWrapper() });

      const invalidateQueries = jest.spyOn(lastQueryClient!, 'invalidateQueries');

      await act(async () => {
        await result.current.mutateAsync('123e4567-e89b-12d3-a456-426614174000');
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(mockCustomerCancelAppointmentFn).toHaveBeenCalledWith(
        '123e4567-e89b-12d3-a456-426614174000',
      );
      // The freed slot must show as available again, and the admin list changed too.
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customerAppointments'] });
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['busySlots'] });
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['appointments'] });
    });
  });

  // ==================== NOTIFICATIONS ====================
  describe('useNotifications', () => {
    it('fetches notifications', async () => {
      mockGetNotificationsFn.mockResolvedValueOnce([{ id: 1, recipient: 'admin', type: 'TEST', message: 'Test', sentAt: '', status: 'SENT' }]);

      await renderHook(() => useNotifications(), { wrapper: createWrapper() });

      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      expect(mockGetNotificationsFn).toHaveBeenCalled();
    });

    it('refetches a stale outbox when the app returns to the foreground', async () => {
      mockGetNotificationsFn.mockResolvedValue([]);
      await renderHook(() => useNotifications({ poll: true }), { wrapper: createWrapper() });
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(mockGetNotificationsFn).toHaveBeenCalledTimes(1);

      try {
        await act(async () => {
          focusManager.setFocused(false);
          focusManager.setFocused(true);
          await new Promise((r) => setTimeout(r, 50));
        });
      } finally {
        focusManager.setFocused(undefined);
      }

      expect(mockGetNotificationsFn).toHaveBeenCalledTimes(2);
    });
  });

  // ==================== REVIEWS ====================
  describe('useBarberRatings', () => {
    it('fetches barber ratings', async () => {
      mockGetBarberRatingsFn.mockResolvedValueOnce([{ barberName: 'Alex', averageRating: 4.8, reviewCount: 10 }]);

      await renderHook(() => useBarberRatings(), { wrapper: createWrapper() });

      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      expect(mockGetBarberRatingsFn).toHaveBeenCalled();
    });
  });

  describe('useSubmitReview', () => {
    it('submits review', async () => {
      mockSubmitReviewFn.mockResolvedValueOnce(undefined);

      const { result } = await renderHook(() => useSubmitReview(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync({
          publicId: 'TF-0001',
          data: { rating: 5, comment: 'Great!', customerEmail: 'john@example.com' },
        });
      });

      expect(mockSubmitReviewFn).toHaveBeenCalledWith('TF-0001', {
        rating: 5,
        comment: 'Great!',
        customerEmail: 'john@example.com',
      });
    });
  });
});
