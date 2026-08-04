const { withAndroidStyles } = require('expo/config-plugins');

/**
 * expo-splash-screen currently writes this API 33-only item into values/styles.xml.
 * Keep the generated base resources compatible with the app's minSdkVersion of 24.
 */
module.exports = function withAndroidSplashApiFix(config) {
  return withAndroidStyles(config, (config) => {
    const styles = config.modResults.resources.style ?? [];

    for (const style of styles) {
      if (style.$?.name !== 'Theme.App.SplashScreen') {
        continue;
      }

      style.item = (style.item ?? []).filter(
        (item) => item.$?.name !== 'android:windowSplashScreenBehavior',
      );
    }

    return config;
  });
};
