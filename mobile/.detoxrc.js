// Expo's (experimental) Metro tree shaking for the release bundle. E2E release builds and the EAS
// `preview` profile run it so it gets device coverage; `production` follows after a green run.
const RELEASE_BUNDLE_ENV = 'EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH=1 EXPO_UNSTABLE_TREE_SHAKING=1';

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
      build: `${RELEASE_BUNDLE_ENV} xcodebuild -workspace ios/TaskFlowMobile.xcworkspace -scheme TaskFlowMobile -configuration Release -sdk iphonesimulator -derivedDataPath ios/build ONLY_ACTIVE_ARCH=YES ARCHS=arm64`,
    },
    'ios.debug': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/TaskFlowMobile.app',
      build: 'xcodebuild -workspace ios/TaskFlowMobile.xcworkspace -scheme TaskFlowMobile -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build',
    },
    'android.release': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/release/app-release.apk',
      // One ABI: the Apple Silicon emulator is arm64-v8a, and every extra ABI repeats the native
      // C++ build. An x86_64 emulator needs DETOX_ANDROID_ABIS=x86_64 (comma-separated list).
      build: `${RELEASE_BUNDLE_ENV} JAVA_HOME="/opt/homebrew/opt/openjdk@21" ANDROID_HOME="$HOME/Library/Android/sdk" ./android/gradlew -p android assembleRelease assembleAndroidTest -DtestBuildType=release -PreactNativeArchitectures="\${DETOX_ANDROID_ABIS:-arm64-v8a}"`,
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
