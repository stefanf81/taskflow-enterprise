const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { test } = require('node:test');

// Exercise the copy resolved by micromatch, the consumer named in Dependabot
// alert #73 (CVE-2026-93687 / GHSA-vfj7-8cjw-p6xm).
const braces = createRequire(require.resolve('micromatch'))('braces');

const nested = (open, body, close, depth) =>
  `${open.repeat(depth)}${body}${close.repeat(depth)}`;

test('rejects deeply nested brace patterns instead of overflowing the stack', () => {
  assert.throws(() => braces(nested('{', 'a,b', '}', 101)), /exceeds max depth/);
});

test('rejects deeply nested parenthesis patterns', () => {
  assert.throws(() => braces(nested('(', 'a,b', ')', 101)), /exceeds max depth/);
});

test('rejects deep patterns through braces.expand', () => {
  assert.throws(() => braces.expand(nested('{', 'a,b', '}', 101)), /exceeds max depth/);
});

test('honors a lower caller-supplied maxDepth', () => {
  assert.throws(() => braces('{{a,b},c}', { maxDepth: 1 }), /exceeds max depth/);
  assert.doesNotThrow(() => braces('{{a,b},c}', { maxDepth: 2 }));
});

test('still expands ordinary patterns', () => {
  assert.deepEqual(braces.expand('a/{b,c}/d'), ['a/b/d', 'a/c/d']);
  assert.deepEqual(braces('a/{b,c}/d'), ['a/(b|c)/d']);
});
