// jest-expo's own JavaScript transformer: its babel-jest (Jest 30) with the Metro caller options.
const presetJsTransform = require('jest-expo/jest-preset').transform['\\.[jt]sx?$'];

module.exports = {
  preset: 'jest-expo',
  // MSW 3's ESM-only URL matcher and cookie parser need transformation under Jest.
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|msw|@msw/url|@mswjs|@open-draft|cookie|rettime|strict-event-emitter|until-async)',
  ],
  // .mjs through the preset's transformer as well: a bare 'babel-jest' resolved the hoisted
  // babel-jest 29 (from @react-native/jest-preset) without jest-expo's caller options.
  transform: {
    '^.+\\.mjs$': presetJsTransform,
  },
  // Mirror the Metro rule in metro/zodLocales.js, so tests run without zod's locale namespace
  // exactly like the app bundle does (only zod requests '../locales/index').
  moduleNameMapper: {
    '^\\.\\./locales/index\\.c?js$': '<rootDir>/metro/empty-zod-locales.js',
  },
  // test/security holds node:test suites (npm run test:security); Jest 30's default
  // testMatch now includes .cjs files.
  testPathIgnorePatterns: ['/node_modules/', '/e2e/', '/test/security/'],
  // The first render in each screen suite loads the whole React Native screen tree
  // (components, icon set) inside that test's own budget. With two workers sharing a
  // CI runner that can exceed Jest's 5 s default and fail the first test of a suite
  // intermittently (AdminDashboardScreen, 1 in 15 cold runs). Slow tests are not
  // slower; only the failure threshold moves.
  testTimeout: 15000,
  setupFiles: [
    '<rootDir>/test/polyfills.ts',
    '<rootDir>/test/asset-registry.ts',
    '<rootDir>/test/expo-network.ts',
  ],
  setupFilesAfterEnv: [
    '@testing-library/react-native/matchers',
    '<rootDir>/test/setup.ts',
  ],
  testEnvironmentOptions: {
    customExportConditions: [''],
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    // Explicitly include the platform-local utility source in coverage.
    '<rootDir>/src/utils/time-utils.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
};
