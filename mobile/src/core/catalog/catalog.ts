import { apiClient, RequestOptions } from '../../api/client';
import { ServiceItem } from '../../types/api';
import { parseContract, parseRequest } from '../../api/contracts';
import { serviceItemResponseListSchema, serviceItemResponseSchema, serviceItemSchema, ServiceItemRequest } from '@taskflow/schemas';

export const catalogApi = {
  createService: async (request: ServiceItemRequest): Promise<ServiceItem> => {
    const payload = parseRequest(serviceItemSchema, request, 'POST /api/v1/catalog');
    const response = await apiClient.post<unknown>('/api/v1/catalog', payload);
    return parseContract(serviceItemResponseSchema, response.data, 'POST /api/v1/catalog');
  },

  updateService: async (id: number, request: ServiceItemRequest): Promise<ServiceItem> => {
    const payload = parseRequest(serviceItemSchema, request, 'PUT /api/v1/catalog/{id}');
    const response = await apiClient.put<unknown>(`/api/v1/catalog/${id}`, payload);
    return parseContract(serviceItemResponseSchema, response.data, 'PUT /api/v1/catalog/{id}');
  },

  retireService: async (id: number): Promise<void> => {
    await apiClient.delete(`/api/v1/catalog/${id}`);
  },

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
