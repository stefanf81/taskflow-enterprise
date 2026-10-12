const fs = require('fs');
const path = require('path');
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withFinalizedMod,
  withInfoPlist,
} = require('expo/config-plugins');

const REQUIRED_POLICY = 'required';
const PIN_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const EXPIRY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_PIN_VALIDITY_DAYS = 365;
const NETWORK_SECURITY_CONFIG_NAME = 'taskflow_network_security_config';
const NETWORK_SECURITY_CONFIG_REF = `@xml/${NETWORK_SECURITY_CONFIG_NAME}`;
const MANIFEST_RELATIVE_PATH = 'app/src/main/AndroidManifest.xml';
const NETWORK_SECURITY_CONFIG_RELATIVE_PATH = `app/src/main/res/xml/${NETWORK_SECURITY_CONFIG_NAME}.xml`;

function parsePins(raw) {
  return (raw ?? '')
    .split(',')
    .map((pin) => pin.trim())
    .filter(Boolean);
}

/** `YYYY-MM-DD` (UTC) for `date`. */
function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Android `<pin-set expiration>` date.
 *
 * After this date Android stops enforcing the pins and falls back to normal
 * certificate validation (the safe failure mode: a forgotten pin rotation
 * degrades to ordinary TLS instead of bricking every installed app). The app
 * must therefore be re-released with fresh pins before it passes.
 *
 * Resolution order: plugin prop `pinExpiration` > env TASKFLOW_API_PIN_EXPIRY >
 * default (build date + 365 days).
 */
function resolvePinExpiration(props, now) {
  const explicit = props.pinExpiration ?? process.env.TASKFLOW_API_PIN_EXPIRY;
  if (explicit === undefined || explicit === null || String(explicit).trim() === '') {
    const fallback = new Date(now.getTime());
    fallback.setUTCDate(fallback.getUTCDate() + DEFAULT_PIN_VALIDITY_DAYS);
    return formatDate(fallback);
  }

  const value = String(explicit).trim();
  const parsed = EXPIRY_PATTERN.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || formatDate(parsed) !== value) {
    throw new Error(
      `TASKFLOW_API_PIN_EXPIRY / pinExpiration must be a valid YYYY-MM-DD date. Received: "${value}".`,
    );
  }
  if (value <= formatDate(now)) {
    throw new Error(
      `TASKFLOW_API_PIN_EXPIRY / pinExpiration (${value}) must be in the future, otherwise Android would never enforce the pins.`,
    );
  }
  return value;
}

function getPinningConfig(props = {}, now = new Date()) {
  if ((process.env.TASKFLOW_TLS_POLICY ?? 'optional') !== REQUIRED_POLICY) {
    return null;
  }

  // EXPO_PUBLIC_E2E_LOCAL_API is the documented runtime HTTPS bypass in
  // src/api/client.ts. A release build that requires pinning must never ship
  // with it enabled.
  if (process.env.EXPO_PUBLIC_E2E_LOCAL_API === 'true') {
    throw new Error(
      'TASKFLOW_TLS_POLICY=required forbids EXPO_PUBLIC_E2E_LOCAL_API=true. ' +
        'Local HTTP E2E builds must use the default (optional) TLS policy.',
    );
  }

  let apiUrl;
  try {
    apiUrl = new URL(process.env.EXPO_PUBLIC_API_URL);
  } catch {
    throw new Error('TASKFLOW_TLS_POLICY=required needs a valid EXPO_PUBLIC_API_URL.');
  }
  if (apiUrl.protocol !== 'https:' || !apiUrl.hostname) {
    throw new Error('TASKFLOW_TLS_POLICY=required requires an HTTPS API URL with a hostname.');
  }

  // Current pin + REQUIRED backup pin. Prefer the SPKI hash of an intermediate
  // or root CA whose renewal chain you control (see README): Android accepts
  // the connection when ANY certificate in the validated chain matches, and
  // iOS NSPinnedCAIdentities behaves the same way, so the same pins serve both.
  const pins = parsePins(process.env.TASKFLOW_API_SPKI_PINS);
  if (pins.length < 2 || new Set(pins).size !== pins.length || pins.some((pin) => !PIN_PATTERN.test(pin))) {
    throw new Error(
      'TASKFLOW_TLS_POLICY=required requires two unique SHA-256 SPKI Base64 pins in TASKFLOW_API_SPKI_PINS.',
    );
  }

  // Optional iOS-only leaf pins (NSPinnedLeafIdentities). Leaf-only pinning
  // breaks every user at certificate renewal, so this is opt-in.
  const leafPins = parsePins(process.env.TASKFLOW_API_SPKI_LEAF_PINS);
  if (new Set(leafPins).size !== leafPins.length || leafPins.some((pin) => !PIN_PATTERN.test(pin))) {
    throw new Error(
      'TASKFLOW_API_SPKI_LEAF_PINS must contain unique SHA-256 SPKI Base64 pins (optional).',
    );
  }

  return {
    hostname: apiUrl.hostname,
    pins,
    leafPins,
    expiration: resolvePinExpiration(props, now),
  };
}

function androidNetworkSecurityConfig({ hostname, pins, expiration }) {
  const pinNodes = pins.map((pin) => `            <pin digest="SHA-256">${pin}</pin>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="false">
        <domain includeSubdomains="false">${hostname}</domain>
        <!-- Pins stop being enforced after the expiration date (normal TLS
             validation applies). Re-release the app with fresh pins before then. -->
        <pin-set expiration="${expiration}">
${pinNodes}
        </pin-set>
    </domain-config>
</network-security-config>
`;
}

/**
 * Runs as a FINALIZED mod, i.e. after every other mod (and every other
 * plugin's manifest mod) has run, so the result no longer depends on the order
 * of the `plugins` array. Expo runs the most recently registered manifest mod
 * first, so an earlier-listed plugin silently wins a conflict; without this
 * step, moving `expo-detox-config-plugin` (cleartext localhost config) above
 * this plugin would ship an unpinned release build.
 */
async function enforceAndroidPinning(platformProjectRoot, pinning) {
  const manifestPath = path.join(platformProjectRoot, MANIFEST_RELATIVE_PATH);
  const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

  if (String(application.$['android:usesCleartextTraffic']).toLowerCase() === 'true') {
    throw new Error(
      'TASKFLOW_TLS_POLICY=required: another plugin set android:usesCleartextTraffic="true" ' +
        '(e.g. expo-build-properties). Cleartext traffic is forbidden in a pinned build; remove it.',
    );
  }

  const current = application.$['android:networkSecurityConfig'];
  if (current !== NETWORK_SECURITY_CONFIG_REF) {
    console.warn(
      `[withTaskflowTlsPinning] android:networkSecurityConfig was "${current}" after all plugins ran; ` +
        `forcing ${NETWORK_SECURITY_CONFIG_REF} because TASKFLOW_TLS_POLICY=required.`,
    );
    application.$['android:networkSecurityConfig'] = NETWORK_SECURITY_CONFIG_REF;
    await AndroidConfig.Manifest.writeAndroidManifestAsync(manifestPath, manifest);

    const written = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
    const final = AndroidConfig.Manifest.getMainApplicationOrThrow(written).$[
      'android:networkSecurityConfig'
    ];
    if (final !== NETWORK_SECURITY_CONFIG_REF) {
      throw new Error(
        `TASKFLOW_TLS_POLICY=required: the final AndroidManifest uses "${final}" instead of ` +
          `${NETWORK_SECURITY_CONFIG_REF}. Another plugin overrides the pinned network security config.`,
      );
    }
  }

  // The referenced resource must still be our pinned config (another plugin
  // could have rewritten the file).
  const xmlPath = path.join(platformProjectRoot, NETWORK_SECURITY_CONFIG_RELATIVE_PATH);
  const xml = fs.existsSync(xmlPath) ? fs.readFileSync(xmlPath, 'utf8') : '';
  const intact =
    xml.includes(`<pin-set expiration="${pinning.expiration}">`) &&
    xml.includes('cleartextTrafficPermitted="false"') &&
    !xml.includes('cleartextTrafficPermitted="true"') &&
    pinning.pins.every((pin) => xml.includes(`<pin digest="SHA-256">${pin}</pin>`));
  if (!intact) {
    throw new Error(
      `TASKFLOW_TLS_POLICY=required: ${NETWORK_SECURITY_CONFIG_RELATIVE_PATH} is missing or was modified ` +
        'by another plugin; refusing to build without the pinned network security config.',
    );
  }
}

module.exports = function withTaskflowTlsPinning(config, props = {}) {
  const pinning = getPinningConfig(props);
  if (!pinning) {
    return config;
  }

  config = withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    application.$['android:networkSecurityConfig'] = NETWORK_SECURITY_CONFIG_REF;
    return config;
  });

  config = withDangerousMod(config, ['android', async (config) => {
    const resourceDirectory = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    fs.mkdirSync(resourceDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(resourceDirectory, `${NETWORK_SECURITY_CONFIG_NAME}.xml`),
      androidNetworkSecurityConfig(pinning),
    );
    return config;
  }]);

  // Order-independent guarantee + loud failure (see enforceAndroidPinning).
  config = withFinalizedMod(config, ['android', async (config) => {
    await enforceAndroidPinning(config.modRequest.platformProjectRoot, pinning);
    return config;
  }]);

  return withInfoPlist(config, (config) => {
    const transportSecurity = config.modResults.NSAppTransportSecurity ?? {};
    transportSecurity.NSAllowsArbitraryLoads = false;

    const domain = {
      NSIncludesSubdomains: false,
      // CA/intermediate pins: valid for the whole lifetime of the CA key, so
      // routine leaf renewals do not break the app.
      NSPinnedCAIdentities: pinning.pins.map((pin) => ({ 'SPKI-SHA256-BASE64': pin })),
    };
    if (pinning.leafPins.length > 0) {
      domain.NSPinnedLeafIdentities = pinning.leafPins.map((pin) => ({
        'SPKI-SHA256-BASE64': pin,
      }));
    }
    transportSecurity.NSPinnedDomains = {
      ...(transportSecurity.NSPinnedDomains ?? {}),
      [pinning.hostname]: domain,
    };
    config.modResults.NSAppTransportSecurity = transportSecurity;
    return config;
  });
};

// Test seams for test/security/tls-pinning.test.cjs (the default export stays
// the Expo config plugin).
module.exports.getPinningConfig = getPinningConfig;
module.exports.androidNetworkSecurityConfig = androidNetworkSecurityConfig;
module.exports.enforceAndroidPinning = enforceAndroidPinning;
module.exports.NETWORK_SECURITY_CONFIG_REF = NETWORK_SECURITY_CONFIG_REF;
