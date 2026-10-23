const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Watch only what the app imports from outside its folder (the shared zod schemas); watching the
// whole repository also crawled the backend, frontend and docs on every Metro start.
config.watchFolders = [path.resolve(workspaceRoot, 'shared')];

// The shared schemas resolve zod from this app's node_modules (the repository root has none the
// app uses, and Metro cannot serve files outside the watched folders).
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

const zodLocales = require('./metro/zodLocales');

// Keep zod's unused error-message locales out of the bundle (see metro/zodLocales.js), and bundle
// react-hook-form once: the screens import it as ESM (`import` condition: index.esm.mjs) while
// @hookform/resolvers/zod is CommonJS and requires index.cjs.js, so both builds shipped (~46 KB
// of JS, 3.3% of the release bytecode). Every import of it resolves as a require, like in Jest.
config.resolver.resolveRequest = (context, moduleName, platform) =>
  zodLocales.resolveRequest(
    moduleName === 'react-hook-form' ? { ...context, isESMImport: false } : context,
    moduleName,
    platform,
  );

module.exports = config;
