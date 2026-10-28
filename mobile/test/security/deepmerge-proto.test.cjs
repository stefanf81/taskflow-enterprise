const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { test } = require('node:test');

// Exercise the copies resolved by Expo's config loader and Jest, the consumers named in
// Dependabot alert #86 (GHSA-gcqx-w48m-w2h4); both use the vendored backport.
const consumers = ['@expo/config', 'jest-config'];
const poisoned = () => JSON.parse('{"__proto__":{"isAdmin":true}}');

for (const consumer of consumers) {
  const deepmerge = createRequire(require.resolve(consumer))('deepmerge');

  test(`${consumer}: an own __proto__ key in the target does not replace the result's prototype`, () => {
    const merged = deepmerge(poisoned(), {});
    assert.equal(Object.getPrototypeOf(merged), Object.prototype);
    assert.equal(merged.isAdmin, undefined);
    assert.deepEqual(Object.keys(merged), ['__proto__']);
  });

  test(`${consumer}: a source __proto__ key merged over a primitive does not poison the result`, () => {
    const merged = deepmerge({ settings: 1 }, { settings: poisoned() });
    assert.equal(Object.getPrototypeOf(merged.settings), Object.prototype);
    assert.equal(merged.settings.isAdmin, undefined);
  });

  test(`${consumer}: ordinary merges are unchanged`, () => {
    assert.deepEqual(deepmerge({ a: { b: 1 }, list: [1] }, { a: { c: 2 }, list: [2] }),
      { a: { b: 1, c: 2 }, list: [1, 2] });
  });
}
