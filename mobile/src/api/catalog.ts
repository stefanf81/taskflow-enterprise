import { apiClient } from './client';
import { ServiceItem } from '../types/api';

export const catalogApi = {
  getAllServices: async (): Promise<ServiceItem[]> => {
    const response = await apiClient.get<ServiceItem[]>('/api/v1/catalog');
    return response.data;
  },
};
