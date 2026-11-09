const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { test } = require('node:test');

const appRequire = createRequire(require.resolve('../../package.json'));
const libraryRequire = createRequire(appRequire.resolve('@testing-library/react-native/package.json'));

// A nested app upgrade can leave the hoisted testing library on an older, still-compatible peer.
// Check the library's resolution, not just the version the app or npm ls reports.
test('React Native Testing Library and the app resolve the same test renderer', () => {
  assert.equal(
    libraryRequire.resolve('test-renderer/package.json'),
    appRequire.resolve('test-renderer/package.json'),
  );
});

test('component tests use the test renderer pinned for the hoisted library', () => {
  const { devDependencies } = require('../../../package.json');
  assert.equal(
    libraryRequire('test-renderer/package.json').version,
    devDependencies['test-renderer'],
  );
});
