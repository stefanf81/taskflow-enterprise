import axios from 'axios';
import { Platform } from 'react-native';
import { storage } from '../utils/storage';

/**
 * CSRF token — cached in-memory for the current session.
 * Fetched lazily on first state-changing request, or eagerly
 * on app startup / after login.
 */
let csrfToken: string | null = null;

/**
 * Override the cached CSRF token (e.g. after login / on startup).
 */
export const setCsrfToken = (token: string | null) => {
  csrfToken = token;
};

/**
 * Returns true when the given URL + method is exempt from CSRF
 * protection on the backend.  Safe methods (GET, HEAD, etc.) never
 * need CSRF.
 */
const isCsrfExempt = (url: string, method?: string): boolean => {
  const m = (method || '').toLowerCase();
  if (!['post', 'put', 'delete', 'patch'].includes(m)) {
    return true; // safe methods
  }
  return (
    url === '/api/v1/auth/login' ||
    url === '/api/v1/auth/register' ||
    url === '/api/v1/appointments' ||
    url.startsWith('/api/v1/appointments/public/cancel/') ||
    url.startsWith('/api/v1/reviews/public/')
  );
};

const getBaseUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    let url = process.env.EXPO_PUBLIC_API_URL;
    if (Platform.OS === 'android' && url.includes('localhost')) {
      url = url.replace('localhost', '10.0.2.2');
    }
    // Enforce HTTPS in production builds (not dev — localhost is fine for development)
    if (!__DEV__ && url.startsWith('http://')) {
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
  withCredentials: true, // For cookie support
  timeout: 15000,
});

// ---------------------------------------------------------------------------
// Request interceptor — Bearer token + CSRF header
// ---------------------------------------------------------------------------
apiClient.interceptors.request.use(
  async (config) => {
    // 1. Bearer token (JWT from SecureStore)
    const token = await storage.getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // 2. CSRF double-submit header for state-changing requests
    const url = config.url || '';
    if (!isCsrfExempt(url, config.method)) {
      if (!csrfToken) {
        // Lazy-fetch the token once per session
        try {
          const res = await axios.get<{ token: string }>(
            `${apiClient.defaults.baseURL}/api/v1/auth/csrf`,
            { withCredentials: true },
          );
          csrfToken = res.data.token;
        } catch {
          // CSRF unavailable — request will likely receive a 403
        }
      }
      if (csrfToken) {
        config.headers['X-XSRF-TOKEN'] = csrfToken;
      }
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
      // Auth endpoints handle their own 401s — don't interfere
      if (!url.startsWith('/api/v1/auth/')) {
        await storage.removeToken();
        await storage.removeUserData();
        csrfToken = null; // invalidate CSRF token too
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
