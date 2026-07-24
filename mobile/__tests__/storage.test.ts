import { storage } from '../src/utils/storage';

describe('Storage Utility', () => {
  beforeEach(async () => {
    await storage.removeToken();
    await storage.removeUserData();
  });

  it('stores and retrieves JWT token', async () => {
    const testToken = 'test-jwt-token-xyz';
    await storage.setToken(testToken);
    const retrieved = await storage.getToken();
    expect(retrieved).toBe(testToken);
  });

  it('removes stored token', async () => {
    await storage.setToken('sample-token');
    await storage.removeToken();
    const retrieved = await storage.getToken();
    expect(retrieved).toBeNull();
  });

  it('stores and retrieves user JSON data', async () => {
    const userData = { username: 'admin', role: 'ROLE_ADMIN' };
    await storage.setUserData(userData);
    const retrieved = await storage.getUserData<typeof userData>();
    expect(retrieved).toEqual(userData);
  });
});
