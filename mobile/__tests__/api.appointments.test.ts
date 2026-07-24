import { appointmentsApi } from '../src/api/appointments';
import { apiClient } from '../src/api/client';

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

  describe('getAllAppointments', () => {
    it('fetches appointments with default params', async () => {
      const mockResponse = {
        page: { content: [], totalPages: 0, totalElements: 0, size: 10, number: 0 },
        stats: { total: 0, pending: 0, approved: 0, denied: 0, overdue: 0, progress: 0, approvedRevenue: 0 },
      };
      mockedGet.mockResolvedValueOnce({ data: mockResponse });

      const result = await appointmentsApi.getAllAppointments();
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/appointments', { params: { page: 0, size: 10 } });
      expect(result).toEqual(mockResponse);
    });

    it('includes status filter when not "all"', async () => {
      mockedGet.mockResolvedValueOnce({ data: { page: { content: [] }, stats: null } });
      await appointmentsApi.getAllAppointments('pending');
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/appointments', {
        params: { page: 0, size: 10, status: 'PENDING' },
      });
    });

    it('omits status param when filter is "all"', async () => {
      mockedGet.mockResolvedValueOnce({ data: { page: { content: [] }, stats: null } });
      await appointmentsApi.getAllAppointments('all');
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/appointments', { params: { page: 0, size: 10 } });
    });

    it('includes search term when provided', async () => {
      mockedGet.mockResolvedValueOnce({ data: { page: { content: [] }, stats: null } });
      await appointmentsApi.getAllAppointments(undefined, 'Alex');
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/appointments', {
        params: { page: 0, size: 10, search: 'Alex' },
      });
    });
  });

  describe('createAppointment', () => {
    it('sends POST with appointment data', async () => {
      const mockAppt = {
        id: 1, publicId: 'TF-0001', customerName: 'John', customerEmail: 'j@ex.com',
        customerPhone: '+1', barberName: 'Alex', bookingDate: '2026-08-01',
        bookingTime: '10:00', serviceType: 'Haircut', status: 'PENDING' as const,
        createdAt: '', updatedAt: '',
      };
      mockedPost.mockResolvedValueOnce({ data: mockAppt });

      const result = await appointmentsApi.createAppointment({
        customerName: 'John', customerEmail: 'j@ex.com', customerPhone: '+1',
        barberName: 'Alex', bookingDate: '2026-08-01', bookingTime: '10:00', serviceType: 'Haircut',
      });
      expect(mockedPost).toHaveBeenCalledWith('/api/v1/appointments', expect.any(Object));
      expect(result).toEqual(mockAppt);
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
  });

  describe('publicCancelAppointment', () => {
    it('sends PUT with publicId and email', async () => {
      mockedPut.mockResolvedValueOnce({});
      await appointmentsApi.publicCancelAppointment('TF-0001', 'j@ex.com');
      expect(mockedPut).toHaveBeenCalledWith('/api/v1/appointments/public/cancel/TF-0001', { email: 'j@ex.com' });
    });
  });

  describe('updateAppointmentStatus', () => {
    it('sends PUT with status update', async () => {
      mockedPut.mockResolvedValueOnce({ data: { id: 1, status: 'APPROVED' } });
      const result = await appointmentsApi.updateAppointmentStatus(1, 'APPROVED');
      expect(mockedPut).toHaveBeenCalledWith('/api/v1/appointments/1', { status: 'APPROVED' });
      expect(result).toEqual({ id: 1, status: 'APPROVED' });
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
