import { customerApi } from '../src/api/customer';
import { apiClient } from '../src/api/client';
import type { AppointmentPage } from '../src/types/api';

jest.mock('../src/api/client', () => ({
  apiClient: {
    get: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedGet = apiClient.get as jest.Mock;
const mockedDelete = apiClient.delete as jest.Mock;

describe('customerApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAppointments', () => {
    it('fetches customer appointments with pagination', async () => {
      const mockResponse: AppointmentPage = {
        content: [], page: { number: 1, size: 10, totalElements: 25, totalPages: 3 },
      };
      mockedGet.mockResolvedValueOnce({ data: mockResponse });

      const result = await customerApi.getAppointments(1, 10);
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/customer/appointments', {
        params: { page: 1, size: 10 },
      });
      expect(result).toEqual(mockResponse);
    });

    it('uses default pagination values', async () => {
      mockedGet.mockResolvedValueOnce({
        data: { content: [], page: { number: 0, size: 10, totalElements: 0, totalPages: 0 } },
      });
      await customerApi.getAppointments();
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/customer/appointments', {
        params: { page: 0, size: 10 },
      });
    });
  });

  describe('cancelAppointment', () => {
    it('sends DELETE for customer appointment', async () => {
      mockedDelete.mockResolvedValueOnce({});
      await customerApi.cancelAppointment('test-uuid-abc');
      expect(mockedDelete).toHaveBeenCalledWith('/api/v1/customer/appointments/test-uuid-abc');
    });
  });
});
