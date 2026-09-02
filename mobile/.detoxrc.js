/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/jest.config.js',
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  apps: {
    'ios.release': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Release-iphonesimulator/TaskFlowMobile.app',
      build: 'xcodebuild -workspace ios/TaskFlowMobile.xcworkspace -scheme TaskFlowMobile -configuration Release -sdk iphonesimulator -derivedDataPath ios/build ONLY_ACTIVE_ARCH=YES ARCHS=arm64',
    },
    'ios.debug': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/TaskFlowMobile.app',
      build: 'xcodebuild -workspace ios/TaskFlowMobile.xcworkspace -scheme TaskFlowMobile -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build',
    },
    'android.release': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/release/app-release.apk',
      build: 'JAVA_HOME="/opt/homebrew/opt/openjdk@21" ANDROID_HOME="$HOME/Library/Android/sdk" ./android/gradlew -p android assembleRelease assembleAndroidTest -DtestBuildType=release',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 17 Pro',
      },
    },
    emulator: {
      type: 'android.emulator',
      device: {
        avdName: 'Pixel_6_API_35',
      },
    },
  },
  configurations: {
    'ios.sim.release': {
      device: 'simulator',
      app: 'ios.release',
    },
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.debug',
    },
    'android.emu.release': {
      device: 'emulator',
      app: 'android.release',
    },
  },
  behavior: {
    init: {
      reinstallApp: true,
      exposeGlobals: true,
    },
    launchApp: 'auto',
    cleanup: {
      shutdownDevice: false,
    },
  },
};
