import path from 'path';

const { workspaceBlockList } = require('../metro/workspaceBlockList');

const workspaceRoot = path.resolve(__dirname, '../..');
const blocked = (pkg: string) =>
  (workspaceBlockList(workspaceRoot) as RegExp[]).some((pattern) =>
    pattern.test(path.join(workspaceRoot, 'node_modules', pkg, 'package.json')),
  );

describe('Metro workspace blockList', () => {
  it('never hides a package the app or its toolchain reaches', () => {
    for (const pkg of ['react', 'react-native', 'expo', 'zod', '@expo/metro-config', '@tanstack/react-query']) {
      expect(blocked(pkg)).toBe(false);
    }
  });

  it('hides frontend-only packages from the crawl', () => {
    for (const pkg of ['@angular/core', 'vitest', '@playwright/test']) {
      expect(blocked(pkg)).toBe(true);
    }
  });

  it('only matches inside the hoisted node_modules', () => {
    expect(blocked('../mobile/src')).toBe(false);
  });
});
