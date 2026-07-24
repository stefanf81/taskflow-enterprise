import { reviewsApi } from '../src/api/reviews';
import { apiClient } from '../src/api/client';

jest.mock('../src/api/client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockedGet = apiClient.get as jest.Mock;
const mockedPost = apiClient.post as jest.Mock;

describe('reviewsApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getBarberRatings', () => {
    it('fetches all barber ratings', async () => {
      const mockRatings = [
        { barberName: 'Alex', averageRating: 4.8, reviewCount: 12 },
        { barberName: 'Sara', averageRating: 4.9, reviewCount: 8 },
      ];
      mockedGet.mockResolvedValueOnce({ data: mockRatings });

      const result = await reviewsApi.getBarberRatings();
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/reviews/public/barber-ratings');
      expect(result).toEqual(mockRatings);
    });
  });

  describe('submitReview', () => {
    it('sends POST with review data for given publicId', async () => {
      mockedPost.mockResolvedValueOnce({});
      const reviewData = { rating: 5, comment: 'Excellent service!' };
      await reviewsApi.submitReview('TF-0001', reviewData);
      expect(mockedPost).toHaveBeenCalledWith('/api/v1/reviews/public/TF-0001', reviewData);
    });
  });
});
