'use strict';

const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { compileModsAsync } = require('expo/config-plugins');
const {
  withNetworkSecurityConfigManifest,
} = require('expo-detox-config-plugin/build/withNetworkSecurityConfig');

const plugin = require('../../plugins/withTaskflowTlsPinning');

const PIN_A = 'A'.repeat(43) + '=';
const PIN_B = 'B'.repeat(43) + '=';
const PIN_C = 'C'.repeat(43) + '=';
const HOSTNAME = 'api.example.com';
const API_URL = `https://${HOSTNAME}`;
const NSC_REF = '@xml/taskflow_network_security_config';
const NSC_FILE = 'app/src/main/res/xml/taskflow_network_security_config.xml';

const MANAGED_ENV = [
  'TASKFLOW_TLS_POLICY',
  'EXPO_PUBLIC_API_URL',
  'TASKFLOW_API_SPKI_PINS',
  'TASKFLOW_API_SPKI_CA_PINS',
  'TASKFLOW_API_SPKI_LEAF_PINS',
  'TASKFLOW_API_PIN_EXPIRY',
  'EXPO_PUBLIC_E2E_LOCAL_API',
];

let savedEnv;

beforeEach(() => {
  savedEnv = {};
  for (const name of MANAGED_ENV) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of MANAGED_ENV) {
    if (savedEnv[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = savedEnv[name];
    }
  }
});

function enableReleasePolicy() {
  process.env.TASKFLOW_TLS_POLICY = 'required';
  process.env.EXPO_PUBLIC_API_URL = API_URL;
  process.env.TASKFLOW_API_SPKI_CA_PINS = `${PIN_A},${PIN_B}`;
}

function baseConfig() {
  return {
    name: 'TaskFlow Mobile',
    slug: 'taskflow-mobile',
    android: { package: 'com.taskflow.mobile' },
    mods: { android: {}, ios: {} },
  };
}

const NOW = new Date('2026-10-12T09:00:00Z');

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('validation: requires a valid HTTPS EXPO_PUBLIC_API_URL', () => {
  process.env.TASKFLOW_TLS_POLICY = 'required';
  assert.throws(() => plugin.getPinningConfig(), /valid EXPO_PUBLIC_API_URL/);

  process.env.EXPO_PUBLIC_API_URL = 'http://api.example.com';
  assert.throws(() => plugin.getPinningConfig(), /requires an HTTPS API URL/);
});

test('validation: requires a current pin AND a backup pin (two unique well-formed pins)', () => {
  process.env.TASKFLOW_TLS_POLICY = 'required';
  process.env.EXPO_PUBLIC_API_URL = API_URL;

  assert.throws(() => plugin.getPinningConfig(), /two unique SHA-256 SPKI Base64 pins/);

  process.env.TASKFLOW_API_SPKI_CA_PINS = PIN_A; // no backup
  assert.throws(() => plugin.getPinningConfig(), /two unique SHA-256 SPKI Base64 pins/);

  process.env.TASKFLOW_API_SPKI_CA_PINS = `${PIN_A},${PIN_A}`;
  assert.throws(() => plugin.getPinningConfig(), /two unique SHA-256 SPKI Base64 pins/);

  process.env.TASKFLOW_API_SPKI_CA_PINS = 'not-a-pin,also-bad';
  assert.throws(() => plugin.getPinningConfig(), /two unique SHA-256 SPKI Base64 pins/);

  process.env.TASKFLOW_API_SPKI_CA_PINS = `${PIN_A},${PIN_B}`;
  assert.deepEqual(plugin.getPinningConfig({}, NOW), {
    hostname: HOSTNAME,
    pins: [PIN_A, PIN_B],
    leafPins: [],
    expiration: '2027-10-12',
  });
});

test('release policy forbids the local-HTTP E2E override', () => {
  enableReleasePolicy();
  process.env.EXPO_PUBLIC_E2E_LOCAL_API = 'true';

  assert.throws(() => plugin.getPinningConfig(), /forbids EXPO_PUBLIC_E2E_LOCAL_API/);
});

test('optional leaf pins (iOS) are validated and kept separate from the CA pins', () => {
  enableReleasePolicy();
  process.env.TASKFLOW_API_SPKI_LEAF_PINS = `${PIN_C}`;
  assert.deepEqual(plugin.getPinningConfig({}, NOW).leafPins, [PIN_C]);

  process.env.TASKFLOW_API_SPKI_LEAF_PINS = 'garbage';
  assert.throws(() => plugin.getPinningConfig({}, NOW), /TASKFLOW_API_SPKI_LEAF_PINS/);

  process.env.TASKFLOW_API_SPKI_LEAF_PINS = `${PIN_C},${PIN_C}`;
  assert.throws(() => plugin.getPinningConfig({}, NOW), /TASKFLOW_API_SPKI_LEAF_PINS/);
});

// ---------------------------------------------------------------------------
// Pin-set expiration (MOB-5)
// ---------------------------------------------------------------------------

test('expiration: defaults to one year after the build date', () => {
  enableReleasePolicy();
  assert.equal(plugin.getPinningConfig({}, NOW).expiration, '2027-10-12');
  assert.equal(plugin.getPinningConfig({}, new Date('2027-01-01T00:00:00Z')).expiration, '2028-01-01');
});

test('expiration: env var and plugin prop override the default (prop wins)', () => {
  enableReleasePolicy();
  process.env.TASKFLOW_API_PIN_EXPIRY = '2027-03-31';
  assert.equal(plugin.getPinningConfig({}, NOW).expiration, '2027-03-31');
  assert.equal(plugin.getPinningConfig({ pinExpiration: '2027-06-30' }, NOW).expiration, '2027-06-30');
});

test('expiration: rejects malformed, impossible and non-future dates', () => {
  enableReleasePolicy();
  for (const bad of ['tomorrow', '2027-13-01', '2027-02-30', '12/10/2027', '2026-10-12', '2025-01-01']) {
    process.env.TASKFLOW_API_PIN_EXPIRY = bad;
    assert.throws(() => plugin.getPinningConfig({}, NOW), /PIN_EXPIRY|pinExpiration/, bad);
  }
});

test('android xml: pin-set carries the expiration attribute and keeps both pins', () => {
  const xml = plugin.androidNetworkSecurityConfig({
    hostname: HOSTNAME,
    pins: [PIN_A, PIN_B],
    expiration: '2027-10-12',
  });
  assert.match(xml, /<pin-set expiration="2027-10-12">/);
  assert.match(xml, /<base-config cleartextTrafficPermitted="false" \/>/);
  assert.match(xml, /<domain-config cleartextTrafficPermitted="false">/);
  assert.ok(xml.includes(`<domain includeSubdomains="false">${HOSTNAME}</domain>`));
  assert.ok(xml.includes(`<pin digest="SHA-256">${PIN_A}</pin>`));
  assert.ok(xml.includes(`<pin digest="SHA-256">${PIN_B}</pin>`));
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')); // AAPT: no leading whitespace
});

// ---------------------------------------------------------------------------
// Mod registration
// ---------------------------------------------------------------------------

test('optional policy leaves config untouched and registers no mods', () => {
  const config = plugin(baseConfig());
  assert.equal(config.mods.android.manifest, undefined);
  assert.equal(config.mods.android.dangerous, undefined);
  assert.equal(config.mods.android.finalized, undefined);
  assert.equal(config.mods.ios.infoPlist, undefined);

  // The E2E override is allowed when pinning is not required (local builds).
  process.env.EXPO_PUBLIC_E2E_LOCAL_API = 'true';
  assert.equal(plugin.getPinningConfig(), null);
});

test('android: writes the network security config and registers the manifest attribute', async () => {
  enableReleasePolicy();
  process.env.TASKFLOW_API_PIN_EXPIRY = '2027-10-12';
  const config = plugin(baseConfig());
  assert.equal(typeof config.mods.android.manifest, 'function');
  assert.equal(typeof config.mods.android.dangerous, 'function');
  assert.equal(typeof config.mods.android.finalized, 'function');

  const manifestConfig = await config.mods.android.manifest({
    ...config,
    modResults: { manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] } },
  });
  assert.equal(
    manifestConfig.modResults.manifest.application[0].$['android:networkSecurityConfig'],
    NSC_REF,
  );

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-tls-'));
  try {
    await config.mods.android.dangerous({
      ...config,
      modRequest: { platformProjectRoot: tempRoot },
    });
    const xml = fs.readFileSync(path.join(tempRoot, NSC_FILE), 'utf8');
    assert.match(xml, /cleartextTrafficPermitted="false"/);
    assert.match(xml, /<pin-set expiration="2027-10-12">/);
    assert.ok(xml.includes(`<domain includeSubdomains="false">${HOSTNAME}</domain>`));
    assert.ok(xml.includes(`<pin digest="SHA-256">${PIN_A}</pin>`));
    assert.ok(xml.includes(`<pin digest="SHA-256">${PIN_B}</pin>`));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// iOS Info.plist (MOB-5)
// ---------------------------------------------------------------------------

test('ios: pins CA/intermediate identities (not the leaf) and keeps arbitrary loads disabled', async () => {
  enableReleasePolicy();
  const config = plugin(baseConfig());
  assert.equal(typeof config.mods.ios.infoPlist, 'function');

  const result = await config.mods.ios.infoPlist({ ...config, modResults: {} });
  const ats = result.modResults.NSAppTransportSecurity;
  assert.equal(ats.NSAllowsArbitraryLoads, false);
  const domain = ats.NSPinnedDomains[HOSTNAME];
  assert.equal(domain.NSIncludesSubdomains, false);
  assert.deepEqual(
    domain.NSPinnedCAIdentities.map((p) => p['SPKI-SHA256-BASE64']),
    [PIN_A, PIN_B],
  );
  assert.equal(domain.NSPinnedLeafIdentities, undefined);
});

test('ios: leaf identities are emitted only when explicitly configured', async () => {
  enableReleasePolicy();
  process.env.TASKFLOW_API_SPKI_LEAF_PINS = `${PIN_C}`;
  const config = plugin(baseConfig());

  const result = await config.mods.ios.infoPlist({ ...config, modResults: {} });
  const domain = result.modResults.NSAppTransportSecurity.NSPinnedDomains[HOSTNAME];
  assert.deepEqual(
    domain.NSPinnedLeafIdentities.map((p) => p['SPKI-SHA256-BASE64']),
    [PIN_C],
  );
  assert.deepEqual(
    domain.NSPinnedCAIdentities.map((p) => p['SPKI-SHA256-BASE64']),
    [PIN_A, PIN_B],
  );
});

test('ios: preserves other pinned domains already in Info.plist', async () => {
  enableReleasePolicy();
  const config = plugin(baseConfig());
  const result = await config.mods.ios.infoPlist({
    ...config,
    modResults: {
      NSAppTransportSecurity: { NSPinnedDomains: { 'other.example.com': { NSIncludesSubdomains: true } } },
    },
  });
  const domains = result.modResults.NSAppTransportSecurity.NSPinnedDomains;
  assert.deepEqual(domains['other.example.com'], { NSIncludesSubdomains: true });
  assert.ok(domains[HOSTNAME]);
});

// ---------------------------------------------------------------------------
// Plugin-order independence and loud failure (MOB-12)
// ---------------------------------------------------------------------------

const MANIFEST_XML = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.taskflow.mobile">
  <application android:name=".MainApplication" android:label="TaskFlow">
    <activity android:name=".MainActivity" android:exported="true" />
  </application>
</manifest>
`;

function createAndroidProject() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-order-'));
  const mainDir = path.join(projectRoot, 'android/app/src/main');
  fs.mkdirSync(mainDir, { recursive: true });
  fs.writeFileSync(path.join(mainDir, 'AndroidManifest.xml'), MANIFEST_XML);
  return projectRoot;
}

function readFinalManifest(projectRoot) {
  return fs.readFileSync(path.join(projectRoot, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
}

/** Detox's cleartext network-security-config step (the one that conflicts), applied as a plugin. */
const detoxNsc = (config) => withNetworkSecurityConfigManifest(config, undefined);

async function compileWith(order) {
  const projectRoot = createAndroidProject();
  let config = baseConfig();
  for (const apply of order) {
    config = apply(config);
  }
  await compileModsAsync(config, { projectRoot, platforms: ['android'] });
  return projectRoot;
}

for (const [label, order] of [
  ['pinning listed BEFORE detox (current app.json order)', [plugin, detoxNsc]],
  ['pinning listed AFTER detox (the order that used to ship an unpinned build)', [detoxNsc, plugin]],
]) {
  test(`order independence: ${label}`, async () => {
    enableReleasePolicy();
    process.env.TASKFLOW_API_PIN_EXPIRY = '2027-10-12';
    const projectRoot = await compileWith(order);
    try {
      const manifest = readFinalManifest(projectRoot);
      assert.match(manifest, /android:networkSecurityConfig="@xml\/taskflow_network_security_config"/);
      assert.doesNotMatch(manifest, /android:networkSecurityConfig="@xml\/network_security_config"/);

      const xml = fs.readFileSync(path.join(projectRoot, 'android', NSC_FILE), 'utf8');
      assert.match(xml, /<pin-set expiration="2027-10-12">/);
      assert.match(xml, new RegExp(`<pin digest="SHA-256">${PIN_A}</pin>`));
      assert.doesNotMatch(xml, /cleartextTrafficPermitted="true"/);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
}

test('without pinning (optional policy) detox keeps its cleartext config in either order', async () => {
  for (const order of [[plugin, detoxNsc], [detoxNsc, plugin]]) {
    const projectRoot = await compileWith(order);
    try {
      const manifest = readFinalManifest(projectRoot);
      assert.match(manifest, /android:networkSecurityConfig="@xml\/network_security_config"/);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  }
});

test('a pinned build fails loudly if another plugin enables cleartext traffic', async () => {
  enableReleasePolicy();
  const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');
  const cleartext = (config) =>
    withAndroidManifest(config, (config) => {
      AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults).$[
        'android:usesCleartextTraffic'
      ] = 'true';
      return config;
    });

  for (const order of [[plugin, cleartext], [cleartext, plugin]]) {
    await assert.rejects(() => compileWith(order), /usesCleartextTraffic/);
  }
});

test('a pinned build fails loudly if the pinned config file is replaced after generation', async () => {
  enableReleasePolicy();
  const { withFinalizedMod } = require('expo/config-plugins');
  // Registered AFTER the pinning plugin, so this finalized mod runs first and the
  // pinning plugin's own verification then sees the tampered file.
  const tamper = (config) =>
    withFinalizedMod(config, [
      'android',
      async (config) => {
        fs.writeFileSync(
          path.join(config.modRequest.platformProjectRoot, NSC_FILE),
          '<network-security-config><base-config cleartextTrafficPermitted="true"/></network-security-config>',
        );
        return config;
      },
    ]);

  await assert.rejects(() => compileWith([plugin, tamper]), /missing or was modified/);
});

test('enforceAndroidPinning rewrites a foreign networkSecurityConfig and warns', async () => {
  const projectRoot = createAndroidProject();
  try {
    const manifestPath = path.join(projectRoot, 'android/app/src/main/AndroidManifest.xml');
    fs.writeFileSync(
      manifestPath,
      MANIFEST_XML.replace(
        '<application ',
        '<application android:networkSecurityConfig="@xml/network_security_config" ',
      ),
    );
    const xmlDir = path.join(projectRoot, 'android/app/src/main/res/xml');
    fs.mkdirSync(xmlDir, { recursive: true });
    const pinning = { hostname: HOSTNAME, pins: [PIN_A, PIN_B], leafPins: [], expiration: '2027-10-12' };
    fs.writeFileSync(
      path.join(xmlDir, 'taskflow_network_security_config.xml'),
      plugin.androidNetworkSecurityConfig(pinning),
    );

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      await plugin.enforceAndroidPinning(path.join(projectRoot, 'android'), pinning);
    } finally {
      console.warn = originalWarn;
    }

    assert.match(readFinalManifest(projectRoot), /android:networkSecurityConfig="@xml\/taskflow_network_security_config"/);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /forcing @xml\/taskflow_network_security_config/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('the pre-rename TASKFLOW_API_SPKI_PINS fails the build instead of silently mis-pinning iOS', () => {
  enableReleasePolicy();
  process.env.TASKFLOW_API_SPKI_PINS = `${PIN_A},${PIN_B}`; // old name, possibly leaf hashes
  assert.throws(() => plugin.getPinningConfig({}, NOW), /TASKFLOW_API_SPKI_CA_PINS/);

  delete process.env.TASKFLOW_API_SPKI_PINS;
  assert.doesNotThrow(() => plugin.getPinningConfig({}, NOW));
});
