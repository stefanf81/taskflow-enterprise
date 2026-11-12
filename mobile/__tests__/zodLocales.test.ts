import fs from 'fs';
import path from 'path';
import * as z from 'zod/mini';
import { EMPTY_LOCALES, EMPTY_MODULE, resolveRequest } from '../metro/zodLocales';

describe('zod locale namespace (metro/zodLocales.js)', () => {
  const upstream = { type: 'sourceFile', filePath: '/upstream.cjs' };
  const contextFrom = (originModulePath: string) => ({
    originModulePath,
    resolveRequest: jest.fn(() => upstream),
  });

  it.each([
    ['/app/node_modules/zod/v4/mini/external.cjs', '../locales/index.cjs'],
    ['/app/node_modules/zod/v4/core/index.cjs', '../locales/index.cjs'],
    ['/app/node_modules/zod/v4/classic/external.js', '../locales/index.js'],
    ['C:\\app\\node_modules\\zod\\v4\\mini\\external.cjs', '../locales/index.cjs'],
  ])('serves the empty namespace to the zod barrel %s', (origin, request) => {
    const context = contextFrom(origin);

    expect(resolveRequest(context, request, 'android')).toEqual({
      type: 'sourceFile',
      filePath: EMPTY_LOCALES,
    });
    expect(context.resolveRequest).not.toHaveBeenCalled();
  });

  it.each([
    // An explicit `zod/locales` import keeps the real locales.
    ['/app/node_modules/zod/locales/index.cjs', '../v4/locales/index.cjs'],
    ['/app/node_modules/zod/v4/locales/index.cjs', './en.cjs'],
    // Same relative request outside zod.
    ['/app/src/screens/HomeScreen.tsx', '../locales/index.cjs'],
    ['/app/node_modules/other/v4/core/index.cjs', '../locales/index.cjs'],
  ])('leaves %s -> %s to the default resolver', (origin, request) => {
    const context = contextFrom(origin);

    expect(resolveRequest(context, request, 'ios')).toBe(upstream);
    expect(context.resolveRequest).toHaveBeenCalledWith(context, request, 'ios');
  });

  it('keeps the shared schema messages and zod/mini defaults without the locales', () => {
    // Jest maps the same module (jest.config.js), so this is the graph the app bundles.
    expect(Object.keys(z.locales).filter((key) => key !== 'default')).toEqual([]);

    const missing = z.string().check(z.minLength(1, 'Name is required')).safeParse('');
    expect(missing.error?.issues[0]?.message).toBe('Name is required');

    const fallback = z.string().check(z.minLength(2)).safeParse('a');
    expect(fallback.error?.issues[0]?.message).toBe('Invalid input');
  });

  it.each([
    ['/app/node_modules/zod/v4/core/index.cjs', './compile.cjs'],
    ['/app/node_modules/zod/v4/core/index.cjs', './memoizer.cjs'],
    ['/app/node_modules/zod/v4/core/index.cjs', './to-json-schema.cjs'],
    ['/app/node_modules/zod/v4/core/index.js', './json-schema-processors.js'],
    ['/app/node_modules/zod/v4/core/index.cjs', './json-schema-generator.cjs'],
    ['/app/node_modules/zod/v4/mini/external.cjs', '../core/json-schema-processors.cjs'],
    ['C:\\app\\node_modules\\zod\\v4\\core\\index.cjs', './compile.cjs'],
  ])('serves an empty module to the zod barrel %s for %s', (origin, request) => {
    const context = contextFrom(origin);

    expect(resolveRequest(context, request, 'android')).toEqual({
      type: 'sourceFile',
      filePath: EMPTY_MODULE,
    });
    expect(context.resolveRequest).not.toHaveBeenCalled();
  });

  it.each([
    // zod's classic API converts to JSON Schema itself and keeps the real modules.
    ['/app/node_modules/zod/v4/classic/schemas.cjs', '../core/to-json-schema.cjs'],
    ['/app/node_modules/zod/v4/classic/external.cjs', '../core/json-schema-processors.cjs'],
    // Modules other than the barrels, and other packages, are untouched.
    ['/app/node_modules/zod/v4/core/compile.cjs', './memoizer.cjs'],
    ['/app/node_modules/zod/v4/core/index.cjs', './schemas.cjs'],
    ['/app/node_modules/other/v4/core/index.cjs', './compile.cjs'],
  ])('leaves %s -> %s to the default resolver', (origin, request) => {
    const context = contextFrom(origin);

    expect(resolveRequest(context, request, 'ios')).toBe(upstream);
  });

  it('parses the shared schemas with zod/mini when the stubbed modules are absent', () => {
    const zodCore = path.dirname(require.resolve('zod/v4/core'));
    jest.isolateModules(() => {
      for (const name of ['compile', 'memoizer', 'to-json-schema', 'json-schema-processors',
        'json-schema-generator']) {
        jest.doMock(path.join(zodCore, `${name}.cjs`), () => ({}));
      }
      expect(require(path.join(zodCore, 'compile.cjs'))).toEqual({});
      const schemas = require('@taskflow/schemas');
      const mini = require('zod/mini');

      expect(schemas.loginResponseSchema.parse({ username: 'jane', role: 'ROLE_CUSTOMER' }))
        .toEqual({ username: 'jane', role: 'ROLE_CUSTOMER' });
      const bad = mini.string().check(mini.minLength(1, 'Name is required')).safeParse('');
      expect(bad.error?.issues[0]?.message).toBe('Name is required');
    });
  });

  it('matches the real barrel files and relative specifiers in the installed zod package', () => {
    const coreEntry = require.resolve('zod/v4/core');
    const miniDir = path.dirname(require.resolve('zod/v4/mini'));
    const miniExternal = path.join(miniDir, 'external.cjs');
    const classicExternal = path.join(path.dirname(coreEntry), '..', 'classic', 'external.cjs');

    const coreSource = fs.readFileSync(coreEntry, 'utf8');
    const miniSource = fs.readFileSync(miniExternal, 'utf8');
    const classicSource = fs.readFileSync(classicExternal, 'utf8');

    // Guard against upstream Zod layout/specifier renames that would silently defeat stubbing.
    for (const [barrel, source] of [
      [coreEntry, coreSource],
      [miniExternal, miniSource],
      [classicExternal, classicSource],
    ] as const) {
      expect(source).toContain('../locales/index.cjs');
      expect(resolveRequest(contextFrom(barrel), '../locales/index.cjs', 'android')).toEqual({
        type: 'sourceFile',
        filePath: EMPTY_LOCALES,
      });
    }

    for (const specifier of [
      './compile.cjs',
      './memoizer.cjs',
      './to-json-schema.cjs',
      './json-schema-processors.cjs',
      './json-schema-generator.cjs',
    ]) {
      expect(coreSource).toContain(specifier);
      expect(resolveRequest(contextFrom(coreEntry), specifier, 'ios')).toEqual({
        type: 'sourceFile',
        filePath: EMPTY_MODULE,
      });
    }

    expect(miniSource).toContain('../core/json-schema-processors.cjs');
    expect(
      resolveRequest(contextFrom(miniExternal), '../core/json-schema-processors.cjs', 'ios'),
    ).toEqual({
      type: 'sourceFile',
      filePath: EMPTY_MODULE,
    });
  });
});
