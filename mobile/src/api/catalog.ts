import { apiClient } from './client';
import { ServiceItem } from '../types/api';
import { parseContract } from './contracts';
import { serviceItemResponseListSchema } from '@taskflow/schemas';

export const catalogApi = {
  getAllServices: async (): Promise<ServiceItem[]> => {
    const response = await apiClient.get<ServiceItem[]>('/api/v1/catalog');
    return parseContract(serviceItemResponseListSchema, response.data, 'GET /api/v1/catalog');
  },
};
