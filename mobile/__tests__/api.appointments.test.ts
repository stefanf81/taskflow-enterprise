import { appointmentsApi } from '../src/core/appointments/appointments';
import { apiClient } from '../src/api/client';
import { getApiErrorMessage } from '../src/utils/errors';
import type { AppointmentDashboardResponse } from '../src/types/api';

jest.mock('../src/api/client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedGet = apiClient.get as jest.Mock;
const mockedPost = apiClient.post as jest.Mock;
const mockedPut = apiClient.put as jest.Mock;
const mockedDelete = apiClient.delete as jest.Mock;

describe('appointmentsApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const emptyDashboard: AppointmentDashboardResponse = {
    page: { content: [], page: { totalPages: 0, totalElements: 0, size: 10, number: 0 } },
    stats: { total: 0, pending: 0, approved: 0, denied: 0, overdue: 0, progress: 0, approvedRevenue: 0 },
  };

  const mockAppt = {
    id: 1,
    publicId: 'TF-0001',
    customerName: 'John',
    customerEmail: 'j@ex.com',
    customerPhone: '+1',
    barberName: 'Alex',
    bookingDate: '2026-08-01',
    bookingTime: '10:00',
    serviceType: 'Haircut',
    status: 'PENDING',
    createdAt: '',
    updatedAt: '',
  };

  describe('getAllAppointments', () => {
    it('fetches appointments with default params', async () => {
      const mockResponse: AppointmentDashboardResponse = emptyDashboard;
      mockedGet.mockResolvedValueOnce({ data: mockResponse });

      const result = await appointmentsApi.getAllAppointments();
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/appointments', { params: { page: 0, size: 10 } });
      expect(result).toEqual(mockResponse);
    });

    it('includes status filter when not "all"', async () => {
      mockedGet.mockResolvedValueOnce({ data: emptyDashboard });
      await appointmentsApi.getAllAppointments('pending');
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/appointments', {
        params: { page: 0, size: 10, status: 'PENDING' },
      });
    });

    it('omits status param when filter is "all"', async () => {
      mockedGet.mockResolvedValueOnce({ data: emptyDashboard });
      await appointmentsApi.getAllAppointments('all');
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/appointments', { params: { page: 0, size: 10 } });
    });

    it('includes search term when provided', async () => {
      mockedGet.mockResolvedValueOnce({ data: emptyDashboard });
      await appointmentsApi.getAllAppointments(undefined, 'Alex');
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/appointments', {
        params: { page: 0, size: 10, search: 'Alex' },
      });
    });
  });

  describe('search (MOB-11)', () => {
    it('trims the search term', async () => {
      mockedGet.mockResolvedValueOnce({ data: emptyDashboard });
      await appointmentsApi.getAllAppointments('overdue', '  john@ex.com ');
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/appointments', {
        params: { page: 0, size: 10, status: 'OVERDUE', search: 'john@ex.com' },
      });
    });

    it('omits a blank search term', async () => {
      mockedGet.mockResolvedValueOnce({ data: emptyDashboard });
      await appointmentsApi.getAllAppointments(undefined, '   ');
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/appointments', { params: { page: 0, size: 10 } });
    });

    it('sends the cancelled status filter upper-cased', async () => {
      mockedGet.mockResolvedValueOnce({ data: emptyDashboard });
      await appointmentsApi.getAllAppointments('cancelled');
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/appointments', {
        params: { page: 0, size: 10, status: 'CANCELLED' },
      });
    });
  });

  describe('getShopTimeZone', () => {
    it('reads the shop zone from the public endpoint', async () => {
      mockedGet.mockResolvedValueOnce({ data: { timeZone: 'America/New_York' } });
      await expect(appointmentsApi.getShopTimeZone()).resolves.toBe('America/New_York');
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/appointments/public/shop');
    });

    it('rejects a response without a zone', async () => {
      mockedGet.mockResolvedValueOnce({ data: {} });
      await expect(appointmentsApi.getShopTimeZone()).rejects.toThrow(/Contract violation/);
    });
  });

  describe('createAppointment', () => {
    it('sends POST with appointment data', async () => {
      mockedPost.mockResolvedValueOnce({ data: mockAppt });

      const result = await appointmentsApi.createAppointment({
        customerName: 'John', customerEmail: 'j@ex.com', customerPhone: '+1',
        barberName: 'Alex', bookingDate: '2026-08-01', bookingTime: '10:00', serviceType: 'Haircut',
      });
      expect(mockedPost).toHaveBeenCalledWith('/api/v1/appointments', expect.any(Object));
      expect(result).toEqual(mockAppt);
    });

    it('rejects a malformed email before sending, with a message a user can act on', async () => {
      const promise = appointmentsApi.createAppointment({
        customerName: 'John', customerEmail: 'not-an-email', customerPhone: '+1',
        barberName: 'Alex', bookingDate: '2026-08-01', bookingTime: '10:00', serviceType: 'Haircut',
      });
      await expect(promise).rejects.toMatchObject({ userFacing: true });
      expect(getApiErrorMessage(await promise.catch((e) => e), 'x')).toMatch(/email/i);
      expect(mockedPost).not.toHaveBeenCalled();
    });

    it('sends the Idempotency-Key header when provided', async () => {
      mockedPost.mockResolvedValueOnce({ data: mockAppt });

      await appointmentsApi.createAppointment(
        {
          customerName: 'John', customerEmail: 'j@ex.com', customerPhone: '+1',
          barberName: 'Alex', bookingDate: '2026-08-01', bookingTime: '10:00', serviceType: 'Haircut',
        },
        'attempt-key-1',
      );

      expect(mockedPost).toHaveBeenCalledWith('/api/v1/appointments', expect.any(Object), {
        headers: { 'Idempotency-Key': 'attempt-key-1' },
      });
    });
  });

  describe('getBusySlots', () => {
    it('fetches busy slots for barber and date', async () => {
      mockedGet.mockResolvedValueOnce({ data: ['10:00', '11:00'] });
      const result = await appointmentsApi.getBusySlots('Alex', '2026-08-01');
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/appointments/public/busy-slots', {
        params: { barberName: 'Alex', bookingDate: '2026-08-01' },
      });
      expect(result).toEqual(['10:00', '11:00']);
    });

    it('passes the selected service so long services are checked against later bookings', async () => {
      mockedGet.mockResolvedValueOnce({ data: ['16:00'] });
      await appointmentsApi.getBusySlots('Alex', '2026-08-01', 'Deluxe Package');
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/appointments/public/busy-slots', {
        params: { barberName: 'Alex', bookingDate: '2026-08-01', serviceType: 'Deluxe Package' },
      });
    });
  });

  describe('publicCancelAppointment', () => {
    it('sends PUT with publicId and email', async () => {
      mockedPut.mockResolvedValueOnce({});
      await appointmentsApi.publicCancelAppointment('TF-0001', 'j@ex.com');
      expect(mockedPut).toHaveBeenCalledWith('/api/v1/appointments/public/cancel/TF-0001', { email: 'j@ex.com' });
    });
  });

  describe('publicCancelAppointment path encoding', () => {
    it('encodes the reference so it stays a single path segment', async () => {
      mockedPut.mockResolvedValueOnce({});
      await appointmentsApi.publicCancelAppointment('a/b?c', 'j@ex.com');
      expect(mockedPut).toHaveBeenCalledWith('/api/v1/appointments/public/cancel/a%2Fb%3Fc', {
        email: 'j@ex.com',
      });
    });
  });

  describe('updateAppointmentStatus', () => {
    it('sends PUT with status update', async () => {
      mockedPut.mockResolvedValueOnce({ data: { ...mockAppt, status: 'APPROVED' } });
      const result = await appointmentsApi.updateAppointmentStatus(1, 'APPROVED');
      expect(mockedPut).toHaveBeenCalledWith('/api/v1/appointments/1', { status: 'APPROVED' });
      expect(result).toEqual({ ...mockAppt, status: 'APPROVED' });
    });
  });

  describe('deleteAppointment', () => {
    it('sends DELETE for given id', async () => {
      mockedDelete.mockResolvedValueOnce({});
      await appointmentsApi.deleteAppointment(5);
      expect(mockedDelete).toHaveBeenCalledWith('/api/v1/appointments/5');
    });
  });
});
