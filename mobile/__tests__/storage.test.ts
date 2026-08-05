import { Platform } from 'react-native';

// ==================== Mock expo-secure-store ====================
const mockSetItemAsync = jest.fn();
const mockGetItemAsync = jest.fn();
const mockDeleteItemAsync = jest.fn();

jest.mock('expo-secure-store', () => ({
  setItemAsync: (...args: any[]) => mockSetItemAsync(...args),
  getItemAsync: (...args: any[]) => mockGetItemAsync(...args),
  deleteItemAsync: (...args: any[]) => mockDeleteItemAsync(...args),
}));

import { storage } from '../src/utils/storage';

describe('storage', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockSetItemAsync.mockResolvedValue(undefined);
    mockGetItemAsync.mockResolvedValue(null);
    mockDeleteItemAsync.mockResolvedValue(undefined);
    // Default to native platform
    (Platform as any).OS = 'ios';
    // Clear module-level memoryStore that persists across tests
    (Platform as any).OS = 'web';
    await storage.removeToken();
    await storage.removeUserData();
    (Platform as any).OS = 'ios';
  });

  // ==================== setToken ====================
  describe('setToken', () => {
    it('stores token via SecureStore on native', async () => {
      await storage.setToken('my-jwt-token');
      expect(mockSetItemAsync).toHaveBeenCalledWith('taskflow_auth_token', 'my-jwt-token');
    });

    it('stores token in memory on web', async () => {
      (Platform as any).OS = 'web';
      await storage.setToken('my-jwt-token');
      expect(mockSetItemAsync).not.toHaveBeenCalled();
      // Should be retrievable
      const token = await storage.getToken();
      expect(token).toBe('my-jwt-token');
    });

    it('fails closed when SecureStore throws on native', async () => {
      mockSetItemAsync.mockRejectedValue(new Error('SecureStore unavailable'));
      await expect(storage.setToken('fallback-token')).rejects.toThrow('Secure credential storage is unavailable.');
    });
  });

  // ==================== getToken ====================
  describe('getToken', () => {
    it('retrieves token from SecureStore on native', async () => {
      mockGetItemAsync.mockResolvedValue('stored-token');
      const token = await storage.getToken();
      expect(token).toBe('stored-token');
      expect(mockGetItemAsync).toHaveBeenCalledWith('taskflow_auth_token');
    });

    it('returns null when no token stored', async () => {
      mockGetItemAsync.mockResolvedValue(null);
      const token = await storage.getToken();
      expect(token).toBeNull();
    });

    it('retrieves token from memory on web', async () => {
      (Platform as any).OS = 'web';
      await storage.setToken('web-token');
      const token = await storage.getToken();
      expect(token).toBe('web-token');
      expect(mockGetItemAsync).not.toHaveBeenCalled();
    });

    it('fails closed when SecureStore throws on get', async () => {
      mockGetItemAsync.mockRejectedValue(new Error('Not available'));
      await expect(storage.getToken()).rejects.toThrow('Secure credential storage is unavailable.');
    });

  });

  // ==================== removeToken ====================
  describe('removeToken', () => {
    it('removes token via SecureStore on native', async () => {
      await storage.removeToken();
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('taskflow_auth_token');
    });

    it('removes token from memory on web', async () => {
      (Platform as any).OS = 'web';
      await storage.setToken('token-to-remove');
      await storage.removeToken();
      const token = await storage.getToken();
      expect(token).toBeNull();
    });

    it('fails closed when SecureStore deletion throws', async () => {
      mockDeleteItemAsync.mockRejectedValue(new Error('fail'));
      await expect(storage.removeToken()).rejects.toThrow('Secure credential removal failed.');
    });
  });

  // ==================== setUserData ====================
  describe('setUserData', () => {
    it('stores user data as JSON via SecureStore on native', async () => {
      const data = { name: 'John', email: 'john@ex.com' };
      await storage.setUserData(data);
      expect(mockSetItemAsync).toHaveBeenCalledWith(
        'taskflow_user_data',
        JSON.stringify(data),
      );
    });

    it('stores user data in memory on web', async () => {
      (Platform as any).OS = 'web';
      const data = { name: 'Web User' };
      await storage.setUserData(data);
      const retrieved = await storage.getUserData<{ name: string }>();
      expect(retrieved).toEqual(data);
    });

    it('fails closed when SecureStore throws', async () => {
      mockSetItemAsync.mockRejectedValue(new Error('fail'));
      const data = { name: 'Fallback' };
      await expect(storage.setUserData(data)).rejects.toThrow('Secure credential storage is unavailable.');
    });
  });

  // ==================== getUserData ====================
  describe('getUserData', () => {
    it('retrieves and parses user data from SecureStore', async () => {
      const data = { name: 'John', role: 'admin' };
      mockGetItemAsync.mockResolvedValue(JSON.stringify(data));
      const result = await storage.getUserData<{ name: string; role: string }>();
      expect(result).toEqual(data);
    });

    it('returns null when no user data', async () => {
      mockGetItemAsync.mockResolvedValue(null);
      const result = await storage.getUserData();
      expect(result).toBeNull();
    });

    it('fails closed when SecureStore read fails', async () => {
      mockGetItemAsync.mockRejectedValue(new Error('fail'));
      await expect(storage.getUserData()).rejects.toThrow('Secure credential storage is unavailable.');
    });
  });

  // ==================== removeUserData ====================
  describe('removeUserData', () => {
    it('removes user data via SecureStore on native', async () => {
      await storage.removeUserData();
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('taskflow_user_data');
    });

    it('removes user data from memory on web', async () => {
      (Platform as any).OS = 'web';
      await storage.setUserData({ temp: true });
      await storage.removeUserData();
      const result = await storage.getUserData();
      expect(result).toBeNull();
    });

    it('fails closed when SecureStore deletion throws', async () => {
      mockDeleteItemAsync.mockRejectedValue(new Error('fail'));
      await expect(storage.removeUserData()).rejects.toThrow('Secure credential removal failed.');
    });
  });

  // ==================== Cross-operation integrity ====================
  it('getToken returns null after removeToken', async () => {
    mockSetItemAsync.mockResolvedValue();
    mockGetItemAsync.mockResolvedValue('temp');
    mockDeleteItemAsync.mockResolvedValue();
    await storage.setToken('temp');
    // Override get to simulate actual removal
    mockGetItemAsync.mockResolvedValue(null);
    await storage.removeToken();
    const token = await storage.getToken();
    expect(token).toBeNull();
  });
});
