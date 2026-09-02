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

---

## 🛠️ Prerequisites

1. **Android Setup:**
   * **JDK 21:** `/opt/homebrew/opt/openjdk@21` (JDK 25 will fail CMake configuration).
   * **Android SDK:** `$HOME/Library/Android/sdk` with Platform Tools (`adb`) and Build Tools (`36.0.0`).
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
   # Executes: JAVA_HOME="/opt/homebrew/opt/openjdk@21" ./android/gradlew -p android assembleRelease assembleAndroidTest -DtestBuildType=release
   ```

3. **Run Detox E2E Test Suite:**
   ```bash
   npm run e2e:test:android
   # Executes: detox test --configuration android.emu.release --no-build
   ```

---

### iOS E2E Execution

1. **Build iOS Simulator Release App Bundle:**
   ```bash
   npm run e2e:build
   # Executes: xcodebuild -workspace ios/TaskFlowMobile.xcworkspace -scheme TaskFlowMobile -configuration Release -sdk iphonesimulator -derivedDataPath ios/build ONLY_ACTIVE_ARCH=YES ARCHS=arm64
   ```

2. **Build Detox Framework Cache (First-Time Only):**
   ```bash
   npx detox build-framework-cache
   ```

3. **Run Detox E2E Test Suite on iOS Simulator:**
   ```bash
   npm run e2e:test
   # Executes: detox test --configuration ios.sim.release --no-build
   ```

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
