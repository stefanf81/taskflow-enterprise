import { renderHook, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

jest.mock('../src/api/appointments', () => ({
  appointmentsApi: {
    getAllAppointments: (...args: unknown[]) => mockGetAllAppointmentsFn(...args),
    getBusySlots: (...args: unknown[]) => mockGetBusySlotsFn(...args),
    createAppointment: (...args: unknown[]) => mockCreateAppointmentFn(...args),
    updateAppointmentStatus: (...args: unknown[]) => mockUpdateAppointmentStatusFn(...args),
    deleteAppointment: (...args: unknown[]) => mockDeleteAppointmentFn(...args),
    publicCancelAppointment: (...args: unknown[]) => mockPublicCancelAppointmentFn(...args),
  },
}));

const mockGetAllBarbersFn = jest.fn();
const mockGetTimeOffFn = jest.fn();
const mockAddTimeOffFn = jest.fn();

jest.mock('../src/api/barbers', () => ({
  barbersApi: {
    getAllBarbers: (...args: unknown[]) => mockGetAllBarbersFn(...args),
    getTimeOff: (...args: unknown[]) => mockGetTimeOffFn(...args),
    addTimeOff: (...args: unknown[]) => mockAddTimeOffFn(...args),
  },
}));

const mockGetAllServicesFn = jest.fn();
jest.mock('../src/api/catalog', () => ({
  catalogApi: {
    getAllServices: (...args: unknown[]) => mockGetAllServicesFn(...args),
  },
}));

const mockCustomerGetAppointmentsFn = jest.fn();
const mockCustomerCancelAppointmentFn = jest.fn();
jest.mock('../src/api/customer', () => ({
  customerApi: {
    getAppointments: (...args: unknown[]) => mockCustomerGetAppointmentsFn(...args),
    cancelAppointment: (...args: unknown[]) => mockCustomerCancelAppointmentFn(...args),
  },
}));

const mockGetNotificationsFn = jest.fn();
jest.mock('../src/api/notifications', () => ({
  notificationsApi: {
    getNotifications: (...args: unknown[]) => mockGetNotificationsFn(...args),
  },
}));

const mockGetBarberRatingsFn = jest.fn();
const mockSubmitReviewFn = jest.fn();
jest.mock('../src/api/reviews', () => ({
  reviewsApi: {
    getBarberRatings: (...args: unknown[]) => mockGetBarberRatingsFn(...args),
    submitReview: (...args: unknown[]) => mockSubmitReviewFn(...args),
  },
}));

// ============================================================
// Test wrapper with QueryClient
// ============================================================
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

import { useAppointments, useBusySlots, useCreateAppointment, useUpdateAppointmentStatus, useDeleteAppointment, usePublicCancelAppointment } from '../src/hooks/useAppointments';
import { useBarbers, useBarberTimeOff, useAddTimeOff } from '../src/hooks/useBarbers';
import { useCatalog } from '../src/hooks/useCatalog';
import { useCustomerAppointments, useCancelCustomerAppointment } from '../src/hooks/useCustomer';
import { useNotifications } from '../src/hooks/useNotifications';
import { useBarberRatings, useSubmitReview } from '../src/hooks/useReviews';

describe('Hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==================== APPOINTMENTS ====================
  describe('useAppointments', () => {
    it('fetches appointments with given params', async () => {
      const mockData = { page: { content: [], totalPages: 0 }, stats: null };
      mockGetAllAppointmentsFn.mockResolvedValueOnce(mockData);

      const { result } = await renderHook(() => useAppointments('pending', 'Alex', 0, 10), {
        wrapper: createWrapper(),
      });

      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      expect(mockGetAllAppointmentsFn).toHaveBeenCalledWith('pending', 'Alex', 0, 10);
      expect(result.current.data).toBeDefined();
    });
  });

  describe('useBusySlots', () => {
    it('fetches busy slots when barber and date are provided', async () => {
      mockGetBusySlotsFn.mockResolvedValueOnce(['10:00']);

      await renderHook(() => useBusySlots('Alex', '2026-08-01'), { wrapper: createWrapper() });

      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      expect(mockGetBusySlotsFn).toHaveBeenCalledWith('Alex', '2026-08-01');
    });

    it('does not fetch when barberName is empty', async () => {
      await renderHook(() => useBusySlots('', '2026-08-01'), { wrapper: createWrapper() });

      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      expect(mockGetBusySlotsFn).not.toHaveBeenCalled();
    });
  });

  describe('useCreateAppointment', () => {
    it('creates appointment', async () => {
      mockCreateAppointmentFn.mockResolvedValueOnce({ id: 1 });

      const { result } = await renderHook(() => useCreateAppointment(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync({
          customerName: 'John', customerEmail: 'j@ex.com', customerPhone: '+1',
          barberName: 'Alex', bookingDate: '2026-08-01', bookingTime: '10:00', serviceType: 'Haircut',
        });
      });

      expect(mockCreateAppointmentFn).toHaveBeenCalled();
    });
  });

  describe('useUpdateAppointmentStatus', () => {
    it('updates status', async () => {
      mockUpdateAppointmentStatusFn.mockResolvedValueOnce({ id: 1, status: 'APPROVED' });

      const { result } = await renderHook(() => useUpdateAppointmentStatus(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync({ id: 1, status: 'APPROVED' });
      });

      expect(mockUpdateAppointmentStatusFn).toHaveBeenCalledWith(1, 'APPROVED');
    });
  });

  describe('useDeleteAppointment', () => {
    it('deletes appointment', async () => {
      mockDeleteAppointmentFn.mockResolvedValueOnce(undefined);

      const { result } = await renderHook(() => useDeleteAppointment(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync(5);
      });

      expect(mockDeleteAppointmentFn).toHaveBeenCalledWith(5);
    });
  });

  describe('usePublicCancelAppointment', () => {
    it('calls public cancel API', async () => {
      mockPublicCancelAppointmentFn.mockResolvedValueOnce(undefined);

      const { result } = await renderHook(() => usePublicCancelAppointment(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync({ publicId: 'TF-0001', email: 'j@ex.com' });
      });

      expect(mockPublicCancelAppointmentFn).toHaveBeenCalledWith('TF-0001', 'j@ex.com');
    });
  });

  // ==================== BARBERS ====================
  describe('useBarbers', () => {
    it('fetches all barbers', async () => {
      mockGetAllBarbersFn.mockResolvedValueOnce([{ id: 1, name: 'Alex', email: '', phone: '' }]);

      await renderHook(() => useBarbers(), { wrapper: createWrapper() });

      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      expect(mockGetAllBarbersFn).toHaveBeenCalled();
    });
  });

  describe('useBarberTimeOff', () => {
    it('fetches time-off when barberId is provided', async () => {
      mockGetTimeOffFn.mockResolvedValueOnce([]);

      await renderHook(() => useBarberTimeOff(1), { wrapper: createWrapper() });

      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      expect(mockGetTimeOffFn).toHaveBeenCalledWith(1);
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

      await act(async () => {
        await result.current.mutateAsync({ barberId: 1, data: { startDate: '2026-08-01', endDate: '2026-08-02', reason: 'Vacation' } });
      });

      expect(mockAddTimeOffFn).toHaveBeenCalledWith(1, { startDate: '2026-08-01', endDate: '2026-08-02', reason: 'Vacation' });
    });
  });

  // ==================== CATALOG ====================
  describe('useCatalog', () => {
    it('fetches all services', async () => {
      mockGetAllServicesFn.mockResolvedValueOnce([{ id: 1, name: 'Haircut', price: 45, durationMinutes: 30, category: 'HAIRCUTS', description: '' }]);

      await renderHook(() => useCatalog(), { wrapper: createWrapper() });

      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      expect(mockGetAllServicesFn).toHaveBeenCalled();
    });
  });

  // ==================== CUSTOMER ====================
  describe('useCustomerAppointments', () => {
    it('fetches customer appointments', async () => {
      mockCustomerGetAppointmentsFn.mockResolvedValueOnce({ content: [], totalPages: 0 });

      await renderHook(() => useCustomerAppointments(0, 10), { wrapper: createWrapper() });

      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      expect(mockCustomerGetAppointmentsFn).toHaveBeenCalledWith(0, 10);
    });
  });

  describe('useCancelCustomerAppointment', () => {
    it('cancels customer appointment', async () => {
      mockCustomerCancelAppointmentFn.mockResolvedValueOnce(undefined);

      const { result } = await renderHook(() => useCancelCustomerAppointment(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync(3);
      });

      expect(mockCustomerCancelAppointmentFn).toHaveBeenCalledWith(3);
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
        await result.current.mutateAsync({ publicId: 'TF-0001', data: { rating: 5, comment: 'Great!' } });
      });

      expect(mockSubmitReviewFn).toHaveBeenCalledWith('TF-0001', { rating: 5, comment: 'Great!' });
    });
  });
});
