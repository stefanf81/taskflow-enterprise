# TaskFlow Mobile — End-to-End (E2E) Testing with Detox

This directory contains the End-to-End (E2E) test suite for TaskFlow Mobile built with [Detox v20](https://wix.github.io/Detox/).

---

## 🎯 Architecture & Design Strategy

### 1. Standalone Release Binary Approach
Detox tests execute against **Release Binaries** containing pre-compiled JavaScript bytecode (`assets/index.android.bundle` / `main.jsbundle`):
* **Eliminates Dev Overlays:** Prevents Expo dev-client connection banners, yellowboxes, or redboxes from intercepting touch events.
* **No Metro Server Required at Runtime:** E2E test runs are completely deterministic, offline-capable, and isolated from Metro dev-server network state or port forwarding race conditions.
* **Production Parity:** Tests execute the exact same bundle and bytecode that end users execute in production.

---

## 📱 Dual-Platform Matrix

Both Android and iOS share the exact same E2E test suite file (`e2e/booking.e2e.test.ts`).

| Platform | Configuration (`.detoxrc.js`) | Target Device | Binary Path |
| :--- | :--- | :--- | :--- |
| **Android** | `android.emu.release` | Android Emulator (`Pixel_6_API_35`) | `android/app/build/outputs/apk/release/app-release.apk` |
| **iOS** | `ios.sim.release` | iOS Simulator (`iPhone 17 Pro`) | `ios/build/Build/Products/Release-iphonesimulator/TaskFlowMobile.app` |

### Nightly CI

`react-native-ci.yml` runs this suite every night (`schedule` only) in the `android-e2e` and `ios-e2e` jobs. There is no Docker on GitHub's macOS runners, so instead of the compose stack both jobs start the packaged backend JAR on `localhost:8080` with the default profile (in-memory H2 with the demo seed data) and build the apps with `EXPO_PUBLIC_API_URL=http://localhost:8080`. The Android job builds `x86_64` (`DETOX_ANDROID_ABIS`) for the runner's emulator. The jobs do not block pull requests; failed-test screenshots and logs are in the `android-e2e-artifacts`/`ios-e2e-artifacts` run artifacts. To rehearse a CI run locally, run the JAR the same way (`./gradlew bootJar`, then `java -jar build/libs/*.jar` without a profile) and build with that API URL.

Both jobs also run on manual workflow dispatch. Before Detox, a bounded authentication preflight
checks mobile login, bearer `/auth/me` and logout with the disposable dev admin. It fails rather
than retries if any operation exceeds the app's existing 10-second request timeout; no app timeout
or Detox assertion is relaxed. This verifies (and warms) the real authentication path, not just liveness.

The artifacts include `e2e-backend-diagnostics/`: preflight timings and CI-only Tomcat access logs
(`timestamp method path status duration`, with `%D` in microseconds; no query strings, headers or
bodies). On failure, a best-effort collector records process CPU/memory, bounded Java 25 platform
and virtual-thread dumps, then another timed authentication probe. Use these with the simulator
screenshot: a `timeout of 10000ms exceeded` message means the HTTP request already failed, so
increasing Detox's wait for `Logout` cannot fix it. A host preflight does not prove simulator networking
is healthy; a later host probe passing can help distinguish a transient/device-side failure.

---

## 🛠️ Prerequisites

1. **Android Setup:**
   * **JDK 21:** `/opt/homebrew/opt/openjdk@21` (JDK 25 will fail CMake configuration).
   * **Android SDK:** `$HOME/Library/Android/sdk` with Platform Tools (`adb`) and Build Tools (`37.0.0`) and Platform 37.0.
   * **Android Emulator:** AVD `Pixel_6_API_35` (API level 35).

2. **iOS Setup:**
   * **Xcode:** >=16.0 (`xcodebuild -version`).
   * **CocoaPods:** >=1.15.0 (`pod --version`), Podfile iOS deployment target `16.4`.
   * **applesimutils:** Installed via Homebrew (`brew install wix/brew/applesimutils`).
   * **iOS Simulator:** `iPhone 17 Pro` (or update `.detoxrc.js` device target).

---

## 🚀 Running E2E Tests

### Android E2E Execution

1. **Start the Android Emulator:**
   ```bash
   $ANDROID_HOME/emulator/emulator -avd Pixel_6_API_35 -netdelay none -netspeed full &
   ```

2. **Build Release APK & Test APK (One-Time or After Native Code Changes):**
   ```bash
   npm run e2e:build:android
   # Executes: EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH=1 EXPO_UNSTABLE_TREE_SHAKING=1 JAVA_HOME="/opt/homebrew/opt/openjdk@21" ANDROID_HOME="$HOME/Library/Android/sdk" ./android/gradlew -p android assembleRelease assembleAndroidTest -DtestBuildType=release -PreactNativeArchitectures="${DETOX_ANDROID_ABIS:-arm64-v8a}"
   ```
   The release build compiles native code for the Apple Silicon emulator's ABI only (`arm64-v8a`). On an x86_64 emulator run `DETOX_ANDROID_ABIS=x86_64 npm run e2e:build:android` (a comma-separated list builds several).

3. **Run Detox E2E Test Suite:**
   ```bash
   npm run e2e:test:android
   # Executes: detox test --configuration android.emu.release
   ```

---

### iOS E2E Execution

1. **Build iOS Simulator Release App Bundle:**
   ```bash
   npm run e2e:build
   # Executes: EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH=1 EXPO_UNSTABLE_TREE_SHAKING=1 xcodebuild -workspace ios/TaskFlowMobile.xcworkspace -scheme TaskFlowMobile -configuration Release -sdk iphonesimulator -derivedDataPath ios/build ONLY_ACTIVE_ARCH=YES ARCHS=arm64
   ```

2. **Build Detox Framework Cache (First-Time Only):**
   ```bash
   npx detox build-framework-cache
   ```

3. **Run Detox E2E Test Suite on iOS Simulator:**
   ```bash
   npm run e2e:test
   # Executes: detox test --configuration ios.sim.release
   ```

---

## 🔧 Local E2E build requirements

* `mobile/.env` must contain `EXPO_PUBLIC_API_URL=http://localhost:4200` (the Docker stack's nginx) and `EXPO_PUBLIC_E2E_LOCAL_API=true`, and the app must be prebuilt **without** `TASKFLOW_TLS_POLICY=required` (that policy refuses local HTTP).
* `EXPO_PUBLIC_E2E_LOCAL_API=true` also freezes the Home promo-dot animation: Detox on iOS waits for the app to go idle and an endless animation keeps it busy forever (every test timed out after 120 s).
* Both release builds bundle with Expo's experimental Metro tree shaking (the two `EXPO_UNSTABLE_*` variables above), the same as the EAS `preview` profile; these runs are its device validation before `production` gets it (see the mobile README, "Tree shaking (staged)"). The variables are not Gradle task inputs: after toggling them, rebuild with `--rerun-tasks` or delete `android/app/build`.
* Android release builds run R8. `plugins/withDetoxProguardRules.js` adds Detox's keep rules only when the Gradle invocation builds an androidTest APK (`npm run e2e:build:android`).
* The iOS Keychain survives reinstalls, so a stored admin token from a previous run makes the app start signed in. Run `xcrun simctl keychain booted reset` before an iOS run. Detox picks any simulator of the configured type (`iPhone 17 Pro`), so with two of them booted reset each one by UDID (`xcrun simctl list devices booted`); otherwise every test fails at the first Home assertion.
* An emulator resumed from an old snapshot keeps the snapshot's clock (seen: three months behind). The wizard then offers days the backend already treats as past, every slot shows "Booked" and Step 3 fails. Check `adb shell date` against the host and cold-boot the AVD (`emulator -avd Pixel_6_API_35 -no-snapshot-load`); setting the time with `adb shell su 0 date …` does not last, the emulator's automatic time sets it back to the snapshot's clock within minutes.
* If D8 runs out of memory, raise `org.gradle.jvmargs` in the generated `android/gradle.properties`.

---

## 🧪 Test Suite Scope (`e2e/booking.e2e.test.ts`)

The E2E suite validates critical guest user journeys end-to-end:

### 1. Guest Booking Flow (Wizard)
- **Home Screen Launch:** Asserts `'LUXURY BARBER SCHEDULER'` header and `home-book-appointment-btn` CTA.
- **Tab Navigation:** Taps `tab-booking` bottom tab to open `BookingScreen`.
- **Step 1 (Treatment Selection):** Asserts `'BOOKING ASSISTANT'`, scrolls down `booking-scroll-view`, taps `Continue to Stylist`, and asserts `'SELECT BARBER'`.
- **Step 2 (Stylist Selection):** Scrolls down, taps `Continue` (No Preference), and asserts `'SELECT OPERATING DAY'`.
- **Step 3 (Date/Time Slot Selection):** Scrolls down, taps `Continue`, and asserts `'4. Contact Details & Summary'`.
- **Step 4 (Customer Contact Details):** Fills `customer-name-input`, `customer-email-input`, and `customer-phone-input` using `replaceText()`, scrolls down, and asserts `'Confirm & Request Booking'` CTA.

### 2. Guest Login Flow
- **Navigation:** Taps `Sign In / Register` button and asserts `'Sign In to TaskFlow'` form header.
- **Validation:** Taps `login-submit-btn` with empty fields and asserts validation prevents screen transition.
- **Form Completion:** Enters credentials in `login-email-input` and `login-password-input` via `replaceText()`, submits form via `login-submit-btn`.

---

## 💡 Important Detox Test Patterns & Gotchas

1. **Native Upper-case Text Matching (`textTransform`):**
   In React Native, styling a `<Text>` with `textTransform: 'uppercase'` compiles to uppercase text in native Android `TextView`s. Detox matchers must match the uppercase string (e.g., `by.text('BOOKING ASSISTANT')`, `by.text('SELECT BARBER')`).

2. **Input Entry (`replaceText` vs `typeText`):**
   Use `.replaceText('text')` instead of `.typeText('text')` for form fields. `replaceText` sets the underlying text buffer directly, avoiding soft-keyboard animation and layout locks (especially on `phone-pad` inputs).

3. **Scrolling for Visibility Threshold (75% Rule):**
   Detox requires views to be at least 75% visible before executing `.tap()`. For components inside a `<ScrollView>`, scroll before tapping:
   ```typescript
   await waitFor(element(by.text('Continue')))
     .toBeVisible()
     .whileElement(by.id('booking-scroll-view'))
     .scroll(200, 'down');
   await element(by.text('Continue')).tap();
   ```

4. **HTTPS Bypass for Local Emulator Tests:**
   The release API client configuration (`src/api/client.ts`) allows `http://10.0.2.2` and `http://localhost` during local emulator testing while strictly enforcing `https://` for external production domains.
