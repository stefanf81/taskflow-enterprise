module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|msw|@mswjs|@open-draft|rettime|strict-event-emitter|until-async)',
  ],
  transform: {
    '^.+\\.mjs$': 'babel-jest',
  },
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
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
