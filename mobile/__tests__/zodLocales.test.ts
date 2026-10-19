import * as z from 'zod/mini';
import { EMPTY_LOCALES, resolveRequest } from '../metro/zodLocales';

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
});
