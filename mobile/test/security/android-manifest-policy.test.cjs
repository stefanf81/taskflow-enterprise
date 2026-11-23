'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { AndroidConfig, compileModsAsync } = require('expo/config-plugins');

// What the release manifest may not carry. The Expo prebuild template declares the first four
// in its main manifest and expo-file-system's library manifest declares the storage pair again;
// the app needs none of them: the calendar export goes to the cache directory and out through
// the share sheet's FileProvider (no storage permission), nothing vibrates, and the React Native
// dev overlay is not used in a release build. `android.blockedPermissions` writes
// `tools:node="remove"`, which also strips a copy merged in from a library.
const BLOCKED = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.VIBRATE',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];

const appConfig = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../../app.json'), 'utf8')).expo;

// The permission and application lines of expo/template.tgz (SDK 58), android/app/src/main.
const TEMPLATE_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">
  <uses-permission android:name="android.permission.INTERNET"/>
  <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>
  <uses-permission android:name="android.permission.VIBRATE"/>
  <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" tools:replace="android:maxSdkVersion"/>
  <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="32" tools:replace="android:maxSdkVersion"/>
  <application android:name=".MainApplication" android:label="@string/app_name" android:allowBackup="false">
    <activity android:name=".MainActivity" android:exported="true" />
  </application>
</manifest>
`;

/** Runs the two prebuild steps that read these keys over a copy of the template manifest. */
async function prebuiltManifest(config) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-manifest-'));
  try {
    const mainDir = path.join(projectRoot, 'android/app/src/main');
    fs.mkdirSync(mainDir, { recursive: true });
    fs.writeFileSync(path.join(mainDir, 'AndroidManifest.xml'), TEMPLATE_MANIFEST);
    let next = { ...config, plugins: [] };
    next = AndroidConfig.AllowBackup.withAllowBackup(next);
    next = AndroidConfig.Permissions.withInternalBlockedPermissions(next);
    await compileModsAsync(next, { projectRoot, platforms: ['android'] });
    return fs.readFileSync(path.join(mainDir, 'AndroidManifest.xml'), 'utf8');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

test('app.json blocks the permissions the app does not use and turns backup off', () => {
  const { android } = appConfig();
  for (const permission of BLOCKED) {
    assert.ok(android.blockedPermissions?.includes(permission), `${permission} is not in android.blockedPermissions`);
  }
  // Unset means true: Expo's prebuild overwrites the template's allowBackup="false" with it.
  assert.equal(android.allowBackup, false);
});

test('the prebuilt manifest removes those permissions and keeps INTERNET', async () => {
  const manifest = await prebuiltManifest(appConfig());

  for (const permission of BLOCKED) {
    const declarations = manifest.match(new RegExp(`<uses-permission[^>]*"${permission}"[^>]*>`, 'g')) ?? [];
    assert.equal(declarations.length, 1, `${permission}: ${declarations.join(' ')}`);
    assert.match(declarations[0], /tools:node="remove"/, permission);
  }
  assert.match(manifest, /<uses-permission android:name="android\.permission\.INTERNET"\/>/);
  assert.match(manifest, /android:allowBackup="false"/);
});

test('without the two keys Expo would ship the template permissions and allowBackup="true"', async () => {
  const { blockedPermissions, allowBackup, ...android } = appConfig().android;
  const manifest = await prebuiltManifest({ ...appConfig(), android });

  assert.doesNotMatch(manifest, /tools:node="remove"/);
  assert.match(manifest, /android:allowBackup="true"/);
});

test('nothing in the app source asks for what is blocked', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        const source = fs.readFileSync(file, 'utf8');
        if (/\bVibration\b|expo-haptics|PermissionsAndroid|Paths\.document|StorageAccessFramework/.test(source)) {
          offenders.push(path.relative(path.join(__dirname, '../..'), file));
        }
      }
    }
  };
  walk(path.join(__dirname, '../../src'));
  assert.deepEqual(offenders, [], 'these files use an API whose permission app.json blocks');
});
