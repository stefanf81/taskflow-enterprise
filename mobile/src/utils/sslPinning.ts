/**
 * SSL Certificate Pinning Utility
 *
 * To enable certificate pinning in production React Native builds,
 * install a native module such as `react-native-ssl-pinning` and
 * configure it with your backend's certificate fingerprints.
 *
 * **Setup (production only):**
 *
 * 1. `npm install react-native-ssl-pinning`
 * 2. Obtain the SHA-256 fingerprint(s) of your backend's TLS certificate:
 *    ```bash
 *    openssl s_client -connect api.example.com:443 2>/dev/null \
 *      | openssl x509 -noout -fingerprint -sha256
 *    ```
 * 3. Add to your production `.env`:
 *    ```
 *    EXPO_PUBLIC_SSL_PIN_FINGERPRINTS=sha256/AAAA...,sha256/BBBB...
 *    ```
 * 4. Uncomment the pinning configuration in `client.ts`.
 *
 * **Development:** Certificate pinning is automatically disabled in __DEV__ mode
 * to allow localhost / self-signed certificates during development.
 */

export interface SslPinningConfig {
  /** SHA-256 certificate fingerprints (comma-separated in env var) */
  fingerprints: string[];
}

/**
 * Parse the EXPO_PUBLIC_SSL_PIN_FINGERPRINTS env var.
 * Returns null if pinning is not configured or disabled.
 */
export const getSslPinningConfig = (): SslPinningConfig | null => {
  // Never pin in development — localhost and emulators use self-signed certs
  if (__DEV__) {
    return null;
  }

  const raw = process.env.EXPO_PUBLIC_SSL_PIN_FINGERPRINTS;
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  const fingerprints = raw
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f.startsWith('sha256/') && f.length > 7);

  if (fingerprints.length === 0) {
    return null;
  }

  return { fingerprints };
};
