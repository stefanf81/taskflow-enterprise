const fs = require('fs');
const path = require('path');
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withInfoPlist,
} = require('expo/config-plugins');

const REQUIRED_POLICY = 'required';
const PIN_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

function getPinningConfig() {
  if ((process.env.TASKFLOW_TLS_POLICY ?? 'optional') !== REQUIRED_POLICY) {
    return null;
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

  const pins = (process.env.TASKFLOW_API_SPKI_PINS ?? '')
    .split(',')
    .map((pin) => pin.trim())
    .filter(Boolean);
  if (pins.length < 2 || new Set(pins).size !== pins.length || pins.some((pin) => !PIN_PATTERN.test(pin))) {
    throw new Error(
      'TASKFLOW_TLS_POLICY=required requires two unique SHA-256 SPKI Base64 pins in TASKFLOW_API_SPKI_PINS.',
    );
  }

  return { hostname: apiUrl.hostname, pins };
}

function androidNetworkSecurityConfig({ hostname, pins }) {
  const pinNodes = pins.map((pin) => `        <pin digest="SHA-256">${pin}</pin>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="false">
        <domain includeSubdomains="false">${hostname}</domain>
        <pin-set>
${pinNodes}
        </pin-set>
    </domain-config>
</network-security-config>
`;
}

module.exports = function withTaskflowTlsPinning(config) {
  const pinning = getPinningConfig();
  if (!pinning) {
    return config;
  }

  config = withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    application.$['android:networkSecurityConfig'] = '@xml/taskflow_network_security_config';
    return config;
  });

  config = withDangerousMod(config, ['android', async (config) => {
    const resourceDirectory = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    fs.mkdirSync(resourceDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(resourceDirectory, 'taskflow_network_security_config.xml'),
      androidNetworkSecurityConfig(pinning),
    );
    return config;
  }]);

  return withInfoPlist(config, (config) => {
    const transportSecurity = config.modResults.NSAppTransportSecurity ?? {};
    transportSecurity.NSAllowsArbitraryLoads = false;
    transportSecurity.NSPinnedDomains = {
      ...(transportSecurity.NSPinnedDomains ?? {}),
      [pinning.hostname]: {
        NSIncludesSubdomains: false,
        NSPinnedLeafIdentities: pinning.pins.map((pin) => ({ 'SPKI-SHA256-BASE64': pin })),
      },
    };
    config.modResults.NSAppTransportSecurity = transportSecurity;
    return config;
  });
};
