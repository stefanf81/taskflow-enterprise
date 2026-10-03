'use strict';

const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const plugin = require('../../plugins/withTaskflowTlsPinning');

const PIN_A = 'A'.repeat(43) + '=';
const PIN_B = 'B'.repeat(43) + '=';
const HOSTNAME = 'api.example.com';
const API_URL = `https://${HOSTNAME}`;

const MANAGED_ENV = [
  'TASKFLOW_TLS_POLICY',
  'EXPO_PUBLIC_API_URL',
  'TASKFLOW_API_SPKI_PINS',
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
  process.env.TASKFLOW_API_SPKI_PINS = `${PIN_A},${PIN_B}`;
}

function baseConfig() {
  return { name: 'TaskFlow Mobile', slug: 'taskflow-mobile', mods: { android: {}, ios: {} } };
}

test('validation: requires a valid HTTPS EXPO_PUBLIC_API_URL', () => {
  process.env.TASKFLOW_TLS_POLICY = 'required';
  assert.throws(() => plugin.getPinningConfig(), /valid EXPO_PUBLIC_API_URL/);

  process.env.EXPO_PUBLIC_API_URL = 'http://api.example.com';
  assert.throws(() => plugin.getPinningConfig(), /requires an HTTPS API URL/);
});

test('validation: requires two unique well-formed pins', () => {
  process.env.TASKFLOW_TLS_POLICY = 'required';
  process.env.EXPO_PUBLIC_API_URL = API_URL;

  assert.throws(() => plugin.getPinningConfig(), /two unique SHA-256 SPKI Base64 pins/);

  process.env.TASKFLOW_API_SPKI_PINS = `${PIN_A},${PIN_A}`;
  assert.throws(() => plugin.getPinningConfig(), /two unique SHA-256 SPKI Base64 pins/);

  process.env.TASKFLOW_API_SPKI_PINS = 'not-a-pin,also-bad';
  assert.throws(() => plugin.getPinningConfig(), /two unique SHA-256 SPKI Base64 pins/);

  process.env.TASKFLOW_API_SPKI_PINS = `${PIN_A},${PIN_B}`;
  assert.deepEqual(plugin.getPinningConfig(), { hostname: HOSTNAME, pins: [PIN_A, PIN_B] });
});

test('release policy forbids the local-HTTP E2E override', () => {
  enableReleasePolicy();
  process.env.EXPO_PUBLIC_E2E_LOCAL_API = 'true';

  assert.throws(() => plugin.getPinningConfig(), /forbids EXPO_PUBLIC_E2E_LOCAL_API/);
});

test('optional policy leaves config untouched and registers no mods', () => {
  const config = plugin(baseConfig());
  assert.equal(config.mods.android.manifest, undefined);
  assert.equal(config.mods.android.dangerous, undefined);
  assert.equal(config.mods.ios.infoPlist, undefined);

  // The E2E override is allowed when pinning is not required (local builds).
  process.env.EXPO_PUBLIC_E2E_LOCAL_API = 'true';
  assert.equal(plugin.getPinningConfig(), null);
});

test('android: writes the network security config and registers the manifest attribute', async () => {
  enableReleasePolicy();
  const config = plugin(baseConfig());
  assert.equal(typeof config.mods.android.manifest, 'function');
  assert.equal(typeof config.mods.android.dangerous, 'function');

  const manifestConfig = await config.mods.android.manifest({
    ...config,
    modResults: { manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] } },
  });
  assert.equal(
    manifestConfig.modResults.manifest.application[0].$['android:networkSecurityConfig'],
    '@xml/taskflow_network_security_config',
  );

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-tls-'));
  try {
    await config.mods.android.dangerous({
      ...config,
      modRequest: { platformProjectRoot: tempRoot },
    });
    const xmlPath = path.join(
      tempRoot,
      'app/src/main/res/xml/taskflow_network_security_config.xml',
    );
    const xml = fs.readFileSync(xmlPath, 'utf8');
    assert.match(xml, /cleartextTrafficPermitted="false"/);
    assert.match(xml, new RegExp(HOSTNAME));
    assert.match(xml, new RegExp(PIN_A.replace(/\+/g, '\\+')));
    assert.match(xml, new RegExp(PIN_B.replace(/\+/g, '\\+')));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('ios: pins the leaf identities and keeps arbitrary loads disabled', async () => {
  enableReleasePolicy();
  const config = plugin(baseConfig());
  assert.equal(typeof config.mods.ios.infoPlist, 'function');

  const result = await config.mods.ios.infoPlist({ ...config, modResults: {} });
  const ats = result.modResults.NSAppTransportSecurity;
  assert.equal(ats.NSAllowsArbitraryLoads, false);
  assert.equal(ats.NSPinnedDomains[HOSTNAME].NSIncludesSubdomains, false);
  assert.deepEqual(
    ats.NSPinnedDomains[HOSTNAME].NSPinnedLeafIdentities.map((p) => p['SPKI-SHA256-BASE64']),
    [PIN_A, PIN_B],
  );
});
