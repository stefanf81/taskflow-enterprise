import { barbersApi } from '../src/api/barbers';
import { apiClient } from '../src/api/client';

jest.mock('../src/api/client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockedGet = apiClient.get as jest.Mock;
const mockedPost = apiClient.post as jest.Mock;

describe('barbersApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPublicBarbers', () => {
    it('fetches public barber data without contact details', async () => {
      const mockBarbers = [
        { id: 1, name: 'Alex' },
        { id: 2, name: 'Sara' },
      ];
      mockedGet.mockResolvedValueOnce({ data: mockBarbers });

      const result = await barbersApi.getPublicBarbers();
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/barbers');
      expect(result).toEqual(mockBarbers);
    });
  });

  describe('getAdminBarbers', () => {
    it('fetches administrative barber contact details from the protected endpoint', async () => {
      const mockBarbers = [{ id: 1, name: 'Alex', email: 'alex@example.com', phone: '+1' }];
      mockedGet.mockResolvedValueOnce({ data: mockBarbers });

      const result = await barbersApi.getAdminBarbers();
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/barbers/admin');
      expect(result).toEqual(mockBarbers);
    });
  });

  describe('getTimeOff', () => {
    it('fetches time-off records for a barber', async () => {
      const mockTimeOff = [{ startDate: '2026-08-01', endDate: '2026-08-03', reason: 'Vacation' }];
      mockedGet.mockResolvedValueOnce({ data: mockTimeOff });

      const result = await barbersApi.getTimeOff(1);
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/barbers/1/time-off');
      expect(result).toEqual(mockTimeOff);
    });
  });

  describe('addTimeOff', () => {
    it('sends POST with time-off data', async () => {
      const timeOffData = { startDate: '2026-08-05', endDate: '2026-08-05', reason: 'Sick day' };
      mockedPost.mockResolvedValueOnce({ data: { id: 1, ...timeOffData } });

      const result = await barbersApi.addTimeOff(1, timeOffData);
      expect(mockedPost).toHaveBeenCalledWith('/api/v1/barbers/1/time-off', timeOffData);
      expect(result).toEqual({ id: 1, ...timeOffData });
    });
  });
});
