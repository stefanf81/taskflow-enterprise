/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  rootDir: '..',
  testMatch: ['<rootDir>/e2e/**/*.test.ts', '<rootDir>/e2e/**/*.test.tsx'],
  // The limit that matters on a loaded iOS runner: Detox's wait for the app to go idle before each
  // action has no timeout of its own, and steps took up to 77 s there (booking.e2e.test.ts has the
  // measurements). A failed step makes the rest of its flow fail at once, so a long timeout costs
  // at most one test per flow.
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
