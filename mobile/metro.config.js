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

module.exports = config;
