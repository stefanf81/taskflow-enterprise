import { catalogApi } from '../src/api/catalog';
import { apiClient } from '../src/api/client';

jest.mock('../src/api/client', () => ({
  apiClient: {
    get: jest.fn(),
  },
}));

const mockedGet = apiClient.get as jest.Mock;

describe('catalogApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllServices', () => {
    it('fetches all services', async () => {
      const mockServices = [
        { id: 1, name: 'Classic Haircut', price: 45, durationMinutes: 30, category: 'hair', description: 'A classic cut.' },
      ];
      mockedGet.mockResolvedValueOnce({ data: mockServices });

      const result = await catalogApi.getAllServices();
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/catalog');
      expect(result).toEqual(mockServices);
    });

    it('returns empty array on empty catalog', async () => {
      mockedGet.mockResolvedValueOnce({ data: [] });
      const result = await catalogApi.getAllServices();
      expect(result).toEqual([]);
    });
  });
});
