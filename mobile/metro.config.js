const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Allow Metro to resolve files from workspace shared/ directory
const workspaceRoot = path.resolve(__dirname, '..');
config.watchFolders = [workspaceRoot];

module.exports = config;
