/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  rootDir: '..',
  testMatch: ['<rootDir>/e2e/**/*.test.ts', '<rootDir>/e2e/**/*.test.tsx'],
  // Room for the longest bounded wait (90 s, booking.e2e.test.ts) plus the unbounded idle waits
  // around it on a loaded iOS runner: the admin sign-in step alone took up to 77 s. A failed step
  // makes the rest of its flow fail at once, so a long timeout costs at most one wait per flow.
  testTimeout: 180000,
  maxWorkers: 1,
  globalSetup: 'detox/runners/jest/globalSetup',
  globalTeardown: 'detox/runners/jest/globalTeardown',
  reporters: ['detox/runners/jest/reporter'],
  testEnvironment: 'detox/runners/jest/testEnvironment',
  transform: {
    '\\.tsx?$': [
      'babel-jest',
      { configFile: './babel.config.js' },
    ],
  },
  verbose: true,
};
