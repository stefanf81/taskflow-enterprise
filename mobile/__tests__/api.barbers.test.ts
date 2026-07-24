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

  describe('getAllBarbers', () => {
    it('fetches all barbers', async () => {
      const mockBarbers = [
        { id: 1, name: 'Alex', email: 'alex@example.com', phone: '+1' },
        { id: 2, name: 'Sara', email: 'sara@example.com', phone: '+2' },
      ];
      mockedGet.mockResolvedValueOnce({ data: mockBarbers });

      const result = await barbersApi.getAllBarbers();
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/barbers');
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
