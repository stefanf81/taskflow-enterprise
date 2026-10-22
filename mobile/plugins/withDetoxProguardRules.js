const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = 'withDetoxProguardRules';
const PROGUARD_FILES_LINE =
  /proguardFiles getDefaultProguardFile\("proguard-android(?:-optimize)?\.txt"\),\s?"proguard-rules\.pro"/;

/**
 * R8 is on for release builds since the Expo SDK 58 template
 * (android.enableMinifyInReleaseBuilds=true). The Detox test APK relies on
 * classes the app already ships (androidx.tracing, Kotlin coroutines), so R8
 * must keep them, or instrumentation crashes on start. expo-detox-config-plugin
 * 13.0 only patched the old `proguard-android.txt` line, and Detox's own rules
 * miss the coroutine intrinsics.
 *
 * The rules are applied only when the Gradle invocation builds an androidTest
 * APK (`npm run e2e:build:android`), so store/EAS release builds keep R8's
 * full shrinking. app.json passes `skipProguard: true` to
 * expo-detox-config-plugin: from 13.1 it also matches the SDK 58
 * `proguard-android-optimize.txt` line and would add its keep rules
 * (kotlin.**, kotlinx.coroutines.**, com.facebook.react.modules.**, …) to
 * every release build.
 */
function addDetoxProguardRules(buildGradle) {
  if (buildGradle.includes(MARKER)) {
    return buildGradle;
  }
  if (!PROGUARD_FILES_LINE.test(buildGradle)) {
    throw new Error(
      '[withDetoxProguardRules] could not find the release proguardFiles line in android/app/build.gradle.',
    );
  }
  return buildGradle.replace(
    PROGUARD_FILES_LINE,
    (line) => `${line}
            // ${MARKER}: Detox E2E builds only (see plugins/withDetoxProguardRules.js)
            if (gradle.startParameter.taskNames.any { it.toLowerCase().contains('androidtest') }) {
                def detoxPackageJson = ["node", "--print", "require.resolve('detox/package.json')"].execute(null, rootDir).text.trim()
                proguardFile(new File(detoxPackageJson, "../android/detox/proguard-rules-app.pro"))
                proguardFile(new File(rootDir, "../plugins/detox-proguard-rules.pro"))
            }`,
  );
}

module.exports = function withDetoxProguardRules(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error('[withDetoxProguardRules] android/app/build.gradle must be Groovy.');
    }
    config.modResults.contents = addDetoxProguardRules(config.modResults.contents);
    return config;
  });
};

module.exports.addDetoxProguardRules = addDetoxProguardRules;
