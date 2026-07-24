import { notificationsApi } from '../src/api/notifications';
import { apiClient } from '../src/api/client';

jest.mock('../src/api/client', () => ({
  apiClient: {
    get: jest.fn(),
  },
}));

const mockedGet = apiClient.get as jest.Mock;

describe('notificationsApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getNotifications', () => {
    it('fetches all notifications', async () => {
      const mockData = [
        { id: 1, recipient: 'admin@taskflow.com', type: 'APPOINTMENT_CONFIRMED', message: 'Confirmed', sentAt: '2026-07-24T10:00:00', status: 'SENT' },
      ];
      mockedGet.mockResolvedValueOnce({ data: mockData });

      const result = await notificationsApi.getNotifications();
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/notifications');
      expect(result).toEqual(mockData);
    });

    it('returns empty array when no notifications', async () => {
      mockedGet.mockResolvedValueOnce({ data: [] });
      const result = await notificationsApi.getNotifications();
      expect(result).toEqual([]);
    });
  });
});
