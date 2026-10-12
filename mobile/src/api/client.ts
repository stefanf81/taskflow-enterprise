import axios from 'axios';
import { Platform } from 'react-native';
import { storage } from '../utils/storage';
import { queryClient } from '../query/queryClient';
import { isPublicEndpoint } from './publicEndpoints';
import { SessionExpiredError, isTokenExpired } from '../utils/session';

const getBaseUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    let url = process.env.EXPO_PUBLIC_API_URL;
    let hostname = '';
    let protocol = '';
    try {
      const parsed = new URL(url);
      hostname = parsed.hostname;
      protocol = parsed.protocol;
    } catch {
      throw new Error('EXPO_PUBLIC_API_URL must be a valid absolute URL.');
    }
    if (Platform.OS === 'android' && hostname === 'localhost') {
      url = url.replace(hostname, '10.0.2.2');
      hostname = '10.0.2.2';
    }
    const isExplicitLocalE2eBuild = process.env.EXPO_PUBLIC_E2E_LOCAL_API === 'true';
    if (!__DEV__ && !isExplicitLocalE2eBuild && protocol !== 'https:') {
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
    return 'http://10.0.2.2:4200';
  }
  return 'http://localhost:4200';
};

export const apiClient = axios.create({
  baseURL: getBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
  // Native auth uses an Authorization bearer header. Do not rely on a browser
  // cookie jar or send ambient cookies from the mobile runtime.
  withCredentials: false,
  timeout: 10000,
});

// ---------------------------------------------------------------------------
// Local session teardown (shared by proactive expiry and 401 handling)
// ---------------------------------------------------------------------------
type SessionEndedHandler = () => void;
let sessionEndedHandler: SessionEndedHandler | null = null;

/**
 * The auth store registers itself here so the client can reset in-memory auth
 * state without importing the store (client -> store -> api/auth -> client
 * would be a cycle).
 */
export function setSessionEndedHandler(handler: SessionEndedHandler | null): void {
  sessionEndedHandler = handler;
}

async function endLocalSession(): Promise<void> {
  try {
    await storage.clearSession();
  } catch {
    // Keychain/Keystore failure — in-memory state is still cleared below.
  }
  queryClient.clear();
  sessionEndedHandler?.();
}

// ---------------------------------------------------------------------------
// Request interceptor — bearer token (protected endpoints only)
// ---------------------------------------------------------------------------
apiClient.interceptors.request.use(
  async (config) => {
    const url = config.url || '';
    // Public endpoints never carry the token: Spring returns 401 for an
    // expired token even on permitAll routes.
    if (isPublicEndpoint(config.method, url)) {
      return config;
    }

    const token = await storage.getToken();
    if (!token) {
      return config;
    }

    // Drop an expired token BEFORE it is sent. Logout is the exception: there
    // is nothing left to revoke, so it simply goes out unauthenticated.
    if (isTokenExpired(await storage.getTokenExpiry())) {
      if (url === '/api/v1/auth/logout') {
        return config;
      }
      await endLocalSession();
      throw new SessionExpiredError();
    }

    config.headers.Authorization = `Bearer ${token}`;
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
      // Public calls carry no token, so a 401 there says nothing about the
      // session. Login/register failures must not destroy a valid session, and
      // neither must a rejected logout. /me is different: a 401 proves the
      // stored bearer token is invalid.
      const isPublic = isPublicEndpoint(error.config?.method, url);
      if (!isPublic && (!url.startsWith('/api/v1/auth/') || url === '/api/v1/auth/me')) {
        await endLocalSession();
      }
    }
    return Promise.reject(error);
  },
);
