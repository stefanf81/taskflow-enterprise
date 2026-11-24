import { retailProductsApi } from '../src/core/catalog/retailProducts';
import { apiClient } from '../src/api/client';
import { isPublicEndpoint } from '../src/api/publicEndpoints';

jest.mock('../src/api/client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

const client = apiClient as unknown as Record<'get' | 'post' | 'put' | 'delete', jest.Mock>;
const clay = { id: 1, name: 'Styling Fiber Clay', sizeLabel: '100ml', price: 24, sortOrder: 1 };

describe('retailProductsApi', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads the public list (sent without a token) and fills a missing size with ""', async () => {
    client.get.mockResolvedValueOnce({ data: [clay, { id: 2, name: 'Comb', price: 5, sortOrder: 2 }] });
    const { signal } = new AbortController();

    const products = await retailProductsApi.getProducts({ signal });

    expect(client.get).toHaveBeenCalledWith('/api/v1/catalog/products', { signal });
    expect(products[1]?.sizeLabel).toBe('');
    expect(isPublicEndpoint('get', '/api/v1/catalog/products')).toBe(true);
    expect(isPublicEndpoint('post', '/api/v1/catalog/products')).toBe(false);
  });

  it('rejects a response that breaks the contract', async () => {
    client.get.mockResolvedValueOnce({ data: [{ id: 1, name: 'Clay' }] });
    await expect(retailProductsApi.getProducts()).rejects.toThrow();
  });

  it('creates, updates and deletes', async () => {
    client.post.mockResolvedValueOnce({ data: clay });
    client.put.mockResolvedValueOnce({ data: clay });
    client.delete.mockResolvedValueOnce({});
    const request = { name: 'Styling Fiber Clay', sizeLabel: '100ml', price: 24, sortOrder: 1 };

    await expect(retailProductsApi.createProduct(request)).resolves.toEqual(clay);
    expect(client.post).toHaveBeenCalledWith('/api/v1/catalog/products', request);
    await retailProductsApi.updateProduct(1, request);
    expect(client.put).toHaveBeenCalledWith('/api/v1/catalog/products/1', request);
    await retailProductsApi.deleteProduct(1);
    expect(client.delete).toHaveBeenCalledWith('/api/v1/catalog/products/1');
  });
});
