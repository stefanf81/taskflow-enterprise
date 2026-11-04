import { apiClient, RequestOptions } from '../../api/client';
import { ServiceItem } from '../../types/api';
import { parseContract } from '../../api/contracts';
import { serviceItemResponseListSchema, serviceItemResponseSchema } from '@taskflow/schemas';

export const catalogApi = {
  /** Admin only: services retired because appointments still reference them. */
  getRetiredServices: async ({ signal }: RequestOptions = {}): Promise<ServiceItem[]> => {
    const response = await apiClient.get<ServiceItem[]>('/api/v1/catalog/retired', { signal });
    return parseContract(
      serviceItemResponseListSchema,
      response.data,
      'GET /api/v1/catalog/retired',
    );
  },

  /** Admin only: makes a retired service bookable again. */
  restoreService: async (id: number): Promise<ServiceItem> => {
    const response = await apiClient.post<ServiceItem>(`/api/v1/catalog/${id}/restore`);
    return parseContract(
      serviceItemResponseSchema,
      response.data,
      'POST /api/v1/catalog/{id}/restore',
    );
  },

  getAllServices: async ({ signal }: RequestOptions = {}): Promise<ServiceItem[]> => {
    const response = await apiClient.get<ServiceItem[]>('/api/v1/catalog', { signal });
    return parseContract(serviceItemResponseListSchema, response.data, 'GET /api/v1/catalog');
  },
};
