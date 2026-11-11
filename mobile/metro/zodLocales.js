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

// The same barrels re-export zod's JSON Schema converter, its parser compiler and the memoizer
// (~185 KB of source, 78 KB / 3% of the release bytecode). Nothing in the app or the shared schemas
// calls toJSONSchema, z.core.compile or the memoizer, and the barrels only expose them through lazy
// getters and re-exports, so these requests get an empty module too - from the core and mini
// barrels only: zod's classic API requires the JSON Schema modules itself and keeps them.
const EMPTY_MODULE = path.join(__dirname, 'empty-zod-module.js');
const CORE_INDEX = /[\\/]node_modules[\\/]zod[\\/]v4[\\/]core[\\/]index\.c?js$/;
const CORE_ONLY =
  /^\.\/(?:compile|memoizer|to-json-schema|json-schema-processors|json-schema-generator)\.c?js$/;
const MINI_EXTERNAL = /[\\/]node_modules[\\/]zod[\\/]v4[\\/]mini[\\/]external\.c?js$/;
const MINI_ONLY = /^\.\.\/core\/json-schema-processors\.c?js$/;

function resolveRequest(context, moduleName, platform) {
  const origin = context.originModulePath;
  if (LOCALES_INDEX.test(moduleName) && ZOD_BARREL.test(origin)) {
    return { type: 'sourceFile', filePath: EMPTY_LOCALES };
  }
  if (
    (CORE_ONLY.test(moduleName) && CORE_INDEX.test(origin)) ||
    (MINI_ONLY.test(moduleName) && MINI_EXTERNAL.test(origin))
  ) {
    return { type: 'sourceFile', filePath: EMPTY_MODULE };
  }
  return context.resolveRequest(context, moduleName, platform);
}

module.exports = { EMPTY_LOCALES, EMPTY_MODULE, resolveRequest };
