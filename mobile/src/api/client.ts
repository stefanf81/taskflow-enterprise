import axios, { type InternalAxiosRequestConfig } from 'axios';
import { Platform } from 'react-native';
import { storage } from '../utils/storage';
import { queryClient } from '../query/queryClient';
import { isPublicEndpoint } from './publicEndpoints';
import {
  SessionChangedError,
  SessionExpiredError,
  computeExpiryMs,
  isTokenExpired,
} from '../utils/session';
import { mobileLoginResponseSchema } from '@taskflow/schemas';
import { parseContract } from './contracts';
import type { LoginResponse } from '../types/api';

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
    const isExplicitLocalE2eBuild = process.env.EXPO_PUBLIC_E2E_LOCAL_API === 'true';
    // E2E builds keep localhost: Detox forwards the emulator's port to the host (`reversePorts`
    // in .detoxrc.js), which avoids the emulator's 10.0.2.2 route that intermittently failed in CI.
    if (Platform.OS === 'android' && hostname === 'localhost' && !isExplicitLocalE2eBuild) {
      url = url.replace(hostname, '10.0.2.2');
      hostname = '10.0.2.2';
    }
    if (!__DEV__ && !isExplicitLocalE2eBuild && protocol !== 'https:') {
      throw new Error(
        'Production API URL must use HTTPS. Found: ' +
          url +
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

/**
 * Per-call options of the API modules' read functions. Query hooks pass TanStack's
 * `signal`, so a request whose query was superseded or unmounted is aborted.
 */
export interface RequestOptions {
  signal?: AbortSignal;
}

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

/**
 * Ends the session of `epoch` (see storage.getSessionEpoch) after the server rejected it, unless
 * a sign-in or sign-out has replaced it meanwhile. The in-memory session goes first, together
 * with the epoch, so nothing keeps acting on it while the Keychain/Keystore is being cleared.
 */
async function endLocalSession(epoch: number): Promise<void> {
  if (storage.getSessionEpoch() !== epoch) return;
  const cleared = storage.clearSession();
  queryClient.clear();
  sessionEndedHandler?.();
  try {
    await cleared;
  } catch {
    // Keychain/Keystore failure: the in-memory session is already gone.
  }
}

/** A renewed session: the new access token and the account the server renewed it for. */
export interface RenewedSession {
  accessToken: string;
  username: string;
  role: LoginResponse['role'];
}

let renewal: { epoch: number; promise: Promise<RenewedSession> } | null = null;

/**
 * Single-flight rotation of the stored refresh token, per session. `epoch` (by default the
 * current one) is the session to renew, fixed before anything is read: when a sign-in or
 * sign-out replaces it at any point (while the refresh token is read, the server answers or the
 * new credentials are stored), nothing is stored and the renewal fails with SessionChangedError,
 * so its caller neither ends, nor sends a request with, the session that replaced it.
 */
export function renewSession(epoch: number = storage.getSessionEpoch()): Promise<string> {
  return renewSessionWithIdentity(epoch).then((renewed) => renewed.accessToken);
}

/**
 * {@link renewSession} with the account the refresh response names, so restoring a session at
 * launch needs no further /me round trip. Shares the same single flight.
 */
export function renewSessionWithIdentity(
  epoch: number = storage.getSessionEpoch(),
): Promise<RenewedSession> {
  if (renewal?.epoch === epoch) return renewal.promise;
  const changed = () => storage.getSessionEpoch() !== epoch;
  const current = {
    epoch,
    promise: (async () => {
      if (changed()) throw new SessionChangedError();
      try {
        const refreshToken = await storage.getRefreshToken();
        if (changed()) throw new SessionChangedError();
        if (!refreshToken) throw new SessionExpiredError();
        const response = await apiClient.post('/api/v1/auth/mobile/refresh', {
          refreshToken,
        });
        const result = parseContract(
          mobileLoginResponseSchema,
          response.data,
          'POST /api/v1/auth/mobile/refresh',
        );
        if (!result.refreshToken) throw new SessionExpiredError();
        const stored = await storage.rotateSession(epoch, {
          token: result.accessToken,
          expiresAt: computeExpiryMs(result.expiresIn),
          refreshToken: result.refreshToken,
        });
        if (!stored || changed()) throw new SessionChangedError();
        return { accessToken: result.accessToken, username: result.username, role: result.role };
      } catch (error) {
        // A rejection (or any other failure) of a session that is gone says nothing about the
        // current one.
        throw changed() ? new SessionChangedError() : error;
      }
    })().finally(() => {
      if (renewal === current) renewal = null;
    }),
  };
  renewal = current;
  return current.promise;
}

function carriedBearer(config: { headers?: unknown } | undefined): boolean {
  const headers = config?.headers as
    | { get?: (name: string) => unknown; Authorization?: unknown }
    | undefined;
  const value =
    typeof headers?.get === 'function' ? headers.get('Authorization') : headers?.Authorization;
  return typeof value === 'string' && value.startsWith('Bearer ');
}

function isSessionRejection(error: unknown): boolean {
  return (
    error instanceof SessionExpiredError ||
    (error as { response?: { status?: number } })?.response?.status === 401
  );
}

/**
 * What the interceptors remember on a protected request's config: the session it was sent under
 * (kept by its replay, which is the same request) and whether it was already replayed.
 */
type SessionRequestConfig = InternalAxiosRequestConfig & {
  sessionEpoch?: number;
  sessionRetried?: boolean;
};

// ---------------------------------------------------------------------------
// Request interceptor — bearer token (protected endpoints only)
// ---------------------------------------------------------------------------
apiClient.interceptors.request.use(
  async (config: SessionRequestConfig) => {
    const url = config.url || '';
    // Public endpoints never carry the token: Spring returns 401 for an
    // expired token even on permitAll routes.
    if (isPublicEndpoint(config.method, url)) {
      return config;
    }

    // A request (or its replay) whose session a sign-in or sign-out replaced never goes out
    // with the credentials of the session that replaced it.
    const epoch = (config.sessionEpoch ??= storage.getSessionEpoch());
    const assertSameSession = () => {
      if (storage.getSessionEpoch() !== epoch) throw new SessionChangedError();
    };
    assertSameSession();

    // Served from storage's in-memory copy; only the first protected request
    // after launch or a credential change reads the keychain/keystore.
    const [storedToken, expiresAt] = await Promise.all([
      storage.getToken(),
      storage.getTokenExpiry(),
    ]);
    assertSameSession();
    let token = storedToken;
    if (!token) {
      return config;
    }

    // Renew an expired token BEFORE it is sent. Logout is the exception: there
    // is nothing left to revoke, so it simply goes out unauthenticated.
    if (isTokenExpired(expiresAt)) {
      if (url === '/api/v1/auth/logout') {
        return config;
      }
      try {
        token = await renewSession(epoch);
      } catch (error) {
        // Only a rejected (or missing) refresh token ends the session; offline, a timeout, a
        // 5xx or an unreadable Keychain/Keystore leave it for the next attempt.
        if (isSessionRejection(error)) {
          await endLocalSession(epoch);
        }
        throw error;
      }
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
        const config = error.config as SessionRequestConfig | undefined;
        const epoch = config?.sessionEpoch;
        // Sent under a session that a sign-in or sign-out has replaced: the 401 is about
        // credentials that are gone, so it neither ends nor renews the current session.
        if (!config || epoch === undefined || epoch !== storage.getSessionEpoch()) {
          return Promise.reject(error);
        }
        // Renew only a session this request actually presented: a request that went out
        // without a bearer token (signed out) must never be signed back in by a 401.
        // Spring rejects the token before any handler runs, so replaying any method once
        // after a successful rotation cannot repeat a side effect.
        if (config.sessionRetried || !carriedBearer(config)) {
          await endLocalSession(epoch);
          return Promise.reject(error);
        }
        config.sessionRetried = true;
        try {
          await renewSession(epoch);
        } catch (renewalError) {
          if (renewalError instanceof SessionChangedError) return Promise.reject(error);
          // A rejected or missing refresh token ends the session, and the caller sees this
          // request's 401. Any other failure (offline, 5xx, unreadable Keychain/Keystore)
          // keeps the session and is reported as it is.
          if (isSessionRejection(renewalError)) {
            await endLocalSession(epoch);
            return Promise.reject(error);
          }
          return Promise.reject(renewalError);
        }
        // The replay keeps this request's epoch: should the session change before it is
        // sent, the request interceptor refuses it with SessionChangedError.
        return apiClient.request(config);
      }
    }
    return Promise.reject(error);
  },
);
