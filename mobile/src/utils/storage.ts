import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TOKEN_KEY = 'taskflow_auth_token';
const USER_KEY = 'taskflow_user_data';

// Memory fallback for web or test environments where SecureStore isn't native
const memoryStore = new Map<string, string>();

export const storage = {
  async setToken(token: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        memoryStore.set(TOKEN_KEY, token);
      } else {
        await SecureStore.setItemAsync(TOKEN_KEY, token);
      }
    } catch {
      memoryStore.set(TOKEN_KEY, token);
    }
  },

  async getToken(): Promise<string | null> {
    try {
      if (Platform.OS === 'web') {
        return memoryStore.get(TOKEN_KEY) || null;
      }
      return await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {
      return memoryStore.get(TOKEN_KEY) || null;
    }
  },

  async removeToken(): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        memoryStore.delete(TOKEN_KEY);
      } else {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
      }
    } catch {
      memoryStore.delete(TOKEN_KEY);
    }
  },

  async setUserData(data: object): Promise<void> {
    const json = JSON.stringify(data);
    try {
      if (Platform.OS === 'web') {
        memoryStore.set(USER_KEY, json);
      } else {
        await SecureStore.setItemAsync(USER_KEY, json);
      }
    } catch {
      memoryStore.set(USER_KEY, json);
    }
  },

  async getUserData<T>(): Promise<T | null> {
    try {
      let json: string | null = null;
      if (Platform.OS === 'web') {
        json = memoryStore.get(USER_KEY) || null;
      } else {
        json = await SecureStore.getItemAsync(USER_KEY);
      }
      return json ? (JSON.parse(json) as T) : null;
    } catch {
      try {
        const json = memoryStore.get(USER_KEY);
        return json ? (JSON.parse(json) as T) : null;
      } catch {
        return null;
      }
    }
  },

  async removeUserData(): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        memoryStore.delete(USER_KEY);
      } else {
        await SecureStore.deleteItemAsync(USER_KEY);
      }
    } catch {
      memoryStore.delete(USER_KEY);
    }
  }
};
