const path = require('path');

// zod's CommonJS barrels (`v4/core/index`, `v4/mini/external`, `v4/classic/external`) require
// every error-message locale for their `locales` namespace export. Metro cannot drop unused
// exports, so all ~60 locales shipped (~320 KB, 14% of the minified Android bundle) and were
// evaluated at startup, although nothing selects one: zod/mini has no default locale and the
// shared schemas carry their own messages. Those barrels get an empty namespace instead; an
// explicit `import { de } from 'zod/locales'` still resolves the real module.
const EMPTY_LOCALES = path.join(__dirname, 'empty-zod-locales.js');
const LOCALES_INDEX = /^\.\.\/locales\/index\.c?js$/;
const ZOD_BARREL = /[\\/]node_modules[\\/]zod[\\/]v4[\\/](?:core|mini|classic)[\\/][^\\/]+$/;

function resolveRequest(context, moduleName, platform) {
  if (LOCALES_INDEX.test(moduleName) && ZOD_BARREL.test(context.originModulePath)) {
    return { type: 'sourceFile', filePath: EMPTY_LOCALES };
  }
  return context.resolveRequest(context, moduleName, platform);
}

module.exports = { EMPTY_LOCALES, resolveRequest };
