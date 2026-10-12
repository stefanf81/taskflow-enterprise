'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { findProblems } = require('../../scripts/check-eas-config.cjs');

const withId = (projectId) => ({ expo: { extra: { eas: { projectId } } } });

test('the placeholder EAS project ID is rejected', () => {
  const problems = findProblems(withId('11111111-2222-3333-4444-555555555555'));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /placeholder/);
});

test('repeated-character placeholders are rejected', () => {
  assert.equal(findProblems(withId('00000000-0000-0000-0000-000000000000')).length, 1);
  assert.equal(findProblems(withId('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).length, 1);
});

test('missing or malformed IDs are rejected', () => {
  assert.match(findProblems({ expo: {} })[0], /missing/);
  assert.match(findProblems(withId('not-a-uuid'))[0], /not a UUID/);
  assert.match(findProblems(withId(''))[0], /missing/);
});

test('a real-looking UUID passes', () => {
  assert.deepEqual(findProblems(withId('9f1c2a7e-4b3d-4c8a-9e21-5d6f7a8b9c0d')), []);
});
