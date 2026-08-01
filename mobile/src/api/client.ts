import axios from 'axios';
import { Platform } from 'react-native';
import { storage } from '../utils/storage';

const getBaseUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    let url = process.env.EXPO_PUBLIC_API_URL;
    const isHttp = url.startsWith('http://');
    // Exact hostname (never substring) so `localhost.evil.com` cannot bypass
    // the production HTTPS guard or hijack the emulator host rewrite.
    let hostname = '';
    try {
      hostname = new URL(url).hostname;
    } catch {
      hostname = ''; // unparseable — treat as non-local below
    }
    if (Platform.OS === 'android' && hostname === 'localhost') {
      url = url.replace(hostname, '10.0.2.2');
      hostname = '10.0.2.2';
    }
    // Enforce HTTPS in production builds (allow http only for local
    // test/emulator hosts, matched exactly).
    if (!__DEV__ && isHttp && hostname !== '10.0.2.2' && hostname !== 'localhost') {
      throw new Error(
        'Production API URL must use HTTPS. Found: ' + url +
        '. Set EXPO_PUBLIC_API_URL to an https:// URL in your production .env file.',
      );
    }
    return url;
  }
  // Android Emulator maps localhost to 10.0.2.2
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8080';
  }
  return 'http://localhost:8080';
};

export const apiClient = axios.create({
  baseURL: getBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
  // Native auth uses an Authorization bearer header. Do not rely on a browser
  // cookie jar or send ambient cookies from the mobile runtime.
  withCredentials: false,
  timeout: 15000,
});

// ---------------------------------------------------------------------------
// Request interceptor — bearer token
// ---------------------------------------------------------------------------
apiClient.interceptors.request.use(
  async (config) => {
    const url = config.url || '';
    const isBootstrapAuthRequest =
      url === '/api/v1/auth/mobile/login' ||
      url === '/api/v1/auth/login' ||
      url === '/api/v1/auth/register';
    const token = isBootstrapAuthRequest ? null : await storage.getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error),
);

// ---------------------------------------------------------------------------
// Response interceptor — auto-logout on 401 (expired / invalid JWT)
// ---------------------------------------------------------------------------
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      const url = error.config?.url || '';
      // Login/register failures should not destroy a currently valid session.
      // /me is different: a 401 proves the stored bearer token is invalid.
      if (!url.startsWith('/api/v1/auth/') || url === '/api/v1/auth/me') {
        await storage.removeToken();
        await storage.removeUserData();
        try {
          // Dynamic import avoids circular dependency:
          //   client → useAuthStore → api/auth → client
          const { useAuthStore } = await import('../store/useAuthStore');
          useAuthStore.setState({
            isAuthenticated: false,
            isLoading: false,
            username: null,
            role: null,
            error: null,
          });
        } catch {
          // Store import failure — non-critical; credentials already cleared
        }
      }
    }
    return Promise.reject(error);
  },
);
