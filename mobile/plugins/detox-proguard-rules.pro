# Keep rules for Detox E2E builds only (added by plugins/withDetoxProguardRules.js
# when the Gradle invocation builds an androidTest APK). The Detox test APK uses
# library classes that the release app already contains, so R8 must not strip them
# from the app. Detox's own proguard-rules-app.pro misses the Kotlin coroutine
# intrinsics (kotlin.coroutines.intrinsics.IntrinsicsKt) used by its runner.
-keep class kotlin.** { *; }
-keep class kotlinx.coroutines.** { *; }
-keep class androidx.tracing.** { *; }
-keep class androidx.concurrent.futures.** { *; }
-dontwarn kotlinx.coroutines.**
