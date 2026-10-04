module.exports = {
  preset: 'jest-expo',
  // MSW 3's ESM-only URL matcher and cookie parser need transformation under Jest 29.
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|msw|@msw/url|@mswjs|@open-draft|cookie|rettime|strict-event-emitter|until-async)',
  ],
  transform: {
    '^.+\\.mjs$': 'babel-jest',
  },
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
  // The first render in each screen suite loads the whole React Native screen tree
  // (components, icon set) inside that test's own budget. With two workers sharing a
  // CI runner that can exceed Jest's 5 s default and fail the first test of a suite
  // intermittently (AdminDashboardScreen, 1 in 15 cold runs). Slow tests are not
  // slower; only the failure threshold moves.
  testTimeout: 15000,
  setupFiles: ['<rootDir>/test/polyfills.ts'],
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
