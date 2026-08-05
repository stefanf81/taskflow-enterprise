import axios from 'axios';
import { Platform } from 'react-native';
import { storage } from '../utils/storage';
import { queryClient } from '../query/queryClient';
import { getSslPinningConfig } from '../utils/sslPinning';

const getBaseUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    let url = process.env.EXPO_PUBLIC_API_URL;
    const isHttp = url.startsWith('http://');
    let hostname = '';
    try {
      hostname = new URL(url).hostname;
    } catch {
      hostname = '';
    }
    if (Platform.OS === 'android' && hostname === 'localhost') {
      url = url.replace(hostname, '10.0.2.2');
      hostname = '10.0.2.2';
    }
    if (!__DEV__ && isHttp && hostname !== '10.0.2.2' && hostname !== 'localhost') {
      throw new Error(
        'Production API URL must use HTTPS. Found: ' + url +
        '. Set EXPO_PUBLIC_API_URL to an https:// URL in your production .env file.',
      );
    }
    return url;
  }
  if (!__DEV__) {
    throw new Error(
      'EXPO_PUBLIC_API_URL is not set. Production builds require an https:// ' +
        'API URL provided via EAS environment variables/secrets.',
    );
  }
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8080';
  }
  return 'http://localhost:8080';
};

// Validate SSL certificate pinning configuration in production builds.
// This does not enforce cryptographic pinning at the network level (that
// requires a native module such as react-native-ssl-pinning) but ensures the
// config is present, parseable, and validated so the deploy pipeline cannot
// accidentally ship without pinning configured.
if (!__DEV__) {
  const sslConfig = getSslPinningConfig();
  if (!sslConfig || sslConfig.fingerprints.length === 0) {
    throw new Error(
      'SSL certificate pinning is not configured for production. ' +
        'Set EXPO_PUBLIC_SSL_PIN_FINGERPRINTS with one or more sha256/... fingerprints. ' +
        'See src/utils/sslPinning.ts for setup instructions.',
    );
  }
}

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
        queryClient.clear();
        try {
          // Dynamic import avoids circular dependency:
          //   client → useAuthStore → api/auth → client
          const { useAuthStore } = await import('../store/useAuthStore');
          useAuthStore.setState({
            isAuthenticated: false,
            isLoading: false,
            username: null,
            role: null,
            isOffline: false,
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
