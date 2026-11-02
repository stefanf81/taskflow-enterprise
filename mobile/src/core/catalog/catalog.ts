import { apiClient, RequestOptions } from '../../api/client';
import { ServiceItem } from '../../types/api';
import { parseContract } from '../../api/contracts';
import { serviceItemResponseListSchema } from '@taskflow/schemas';

export const catalogApi = {
  getAllServices: async ({ signal }: RequestOptions = {}): Promise<ServiceItem[]> => {
    const response = await apiClient.get<ServiceItem[]>('/api/v1/catalog', { signal });
    return parseContract(serviceItemResponseListSchema, response.data, 'GET /api/v1/catalog');
  },
};
