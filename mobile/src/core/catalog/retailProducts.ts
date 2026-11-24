import {
  retailProductResponseListSchema,
  retailProductResponseSchema,
  retailProductSchema,
  RetailProductRequest,
  RetailProductResponse,
} from '@taskflow/schemas';
import { apiClient, RequestOptions } from '../../api/client';
import { parseContract, parseRequest } from '../../api/contracts';

/**
 * Retail products (`/api/v1/catalog/products`, display only): the public list (sent without a
 * token, see api/publicEndpoints.ts) and the owner's writes.
 */
export const retailProductsApi = {
  getProducts: async ({ signal }: RequestOptions = {}): Promise<RetailProductResponse[]> => {
    const response = await apiClient.get<unknown>('/api/v1/catalog/products', { signal });
    return parseContract(retailProductResponseListSchema, response.data, 'GET /api/v1/catalog/products');
  },

  createProduct: async (request: RetailProductRequest): Promise<RetailProductResponse> => {
    const payload = parseRequest(retailProductSchema, request, 'POST /api/v1/catalog/products');
    const response = await apiClient.post<unknown>('/api/v1/catalog/products', payload);
    return parseContract(retailProductResponseSchema, response.data, 'POST /api/v1/catalog/products');
  },

  updateProduct: async (id: number, request: RetailProductRequest): Promise<RetailProductResponse> => {
    const payload = parseRequest(retailProductSchema, request, 'PUT /api/v1/catalog/products/{id}');
    const response = await apiClient.put<unknown>(`/api/v1/catalog/products/${id}`, payload);
    return parseContract(retailProductResponseSchema, response.data, 'PUT /api/v1/catalog/products/{id}');
  },

  deleteProduct: async (id: number): Promise<void> => {
    await apiClient.delete(`/api/v1/catalog/products/${id}`);
  },
};
