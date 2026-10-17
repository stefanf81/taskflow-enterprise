# TaskFlow Mobile Application

A cross-platform mobile application for TaskFlow built with **React Native**, **Expo**, and **TypeScript**. Runs natively on **Android** (phones & tablets) and **iOS** (iPhone & iPad).

## Target Architecture

```
React Native + Expo Mobile Application
              │
        TanStack Query
              │
            Axios
              │
          REST API
              │
      Spring Boot Backend
              │
           Database
```

---

## 🔁 Platform-local Contract Linkage

The mobile app owns its platform-local contract directory under `src/`:

* **API Types (`src/types/api.ts`)**: Generated from the reviewed root-level `api/openapi.json` baseline. Regenerate from the repository root with `npm run sync:api-types` and validate with `npm run sync:api-types:check`.
* **Design System (`src/theme/colors.ts`)**: Imports theme tokens (`obsidian`, `gold`, `status`, `text`) from `src/theme/tokens.json`.
* **Pure Time Utilities (`src/utils/time-utils.ts`)**: Owns pure 12h/24h time formatting and `isOverdue` calculations.

---

## Backend Connectivity & Security Model

The mobile app connects to the Spring Boot REST API (`taskflow-backend`).

### Local Development Setup (`mobile/.env`)

Create the environment file before starting Metro:

```bash
cp .env.example .env
```

Set the URL appropriate for the target platform below. The backend must be
running separately; see `development-set.md` for the complete first-time
installation and native build setup.

* **iOS Simulator**: `http://localhost:4200`
* **Android Emulator**: `http://10.0.2.2:4200` (or leave `EXPO_PUBLIC_API_URL` empty for auto-detection)
* **Physical Device**: `http://<YOUR_MAC_LAN_IP>:4200`

### Production Connection
To connect local simulators, emulators, or production builds to a live production backend:
```bash
# Override API URL directly when starting Metro
EXPO_PUBLIC_API_URL=https://api.yourdomain.com npx expo start -c
```
Production environments enforce TLS/HTTPS encryption, hardware token encryption in **iOS Keychain** / **Android Keystore** via `expo-secure-store`, and Redis IP rate-limiting.

### SSL Certificate Pinning (Production)

Preview and production builds use platform-native SPKI public-key pinning
(`plugins/withTaskflowTlsPinning.js`). The Expo prebuild fails unless the API URL is
HTTPS, a current pin **and a backup pin** are configured, and (Android) the pin-set
has a valid expiration date.

```bash
# Current + backup SHA-256 SPKI hashes (Base64, without a sha256/ prefix).
TASKFLOW_API_SPKI_CA_PINS=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=,BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=
# Optional: Android pin-set expiration (YYYY-MM-DD, must be in the future).
# Default: build date + 365 days.
TASKFLOW_API_PIN_EXPIRY=2027-09-30
# Optional, iOS only: extra NSPinnedLeafIdentities. Leave unset unless you have a reason.
TASKFLOW_API_SPKI_LEAF_PINS=
```

Configuration:
- **Development**: Local HTTP remains available for simulators and emulators.
- **Preview and production (EAS)**: Set `TASKFLOW_TLS_POLICY=required` and configure `TASKFLOW_API_SPKI_CA_PINS` in the selected EAS environment.
- **Enforcement**: the plugin writes the Android `network_security_config` (`<pin-set expiration="...">`) and the iOS `NSPinnedDomains` entry (`NSPinnedCAIdentities`) during prebuild; Axios traffic is pinned by the platform networking stack.
- **Plugin order does not matter**: a finalized config-plugin step re-checks the final `AndroidManifest.xml` and forces `android:networkSecurityConfig` to the pinned config (so `expo-detox-config-plugin`'s cleartext localhost config can never win in a pinned build). It fails the build if `android:usesCleartextTraffic="true"` is set by another plugin or the pinned XML was altered.

**Which key to pin (do not pin only the leaf).** A pin on the server's *leaf*
key stops matching the moment the certificate is renewed with a new key
(Let's Encrypt-style 60-90 day rotation does exactly that), and every installed
app then refuses to connect until users update. Instead:

1. Pin the SPKI hash of an **intermediate or root CA whose renewal chain you
   control** (the CA that will keep issuing your certificates), as the current pin.
2. Add a **pre-generated backup pin** - the SPKI hash of a different CA/intermediate
   (or a next key you already hold offline) that you can switch to if the current
   one has to be replaced. The plugin refuses a single pin.
3. Use the **same pins on both platforms**. Android's `<pin-set>` accepts the
   connection when *any* certificate in the validated chain matches a pin; iOS
   `NSPinnedCAIdentities` is also matched against the CA certificates in the chain,
   so a CA SPKI hash works unchanged in both. Therefore `TASKFLOW_API_SPKI_CA_PINS`
   feeds both Android `<pin>` entries and iOS `NSPinnedCAIdentities`.
4. `TASKFLOW_API_SPKI_LEAF_PINS` is optional and iOS-only (`NSPinnedLeafIdentities`).
   Do not use it as your only pin.

> **Migration note:** earlier versions read `TASKFLOW_API_SPKI_PINS` and applied it
> as iOS *leaf* identities. That variable is now rejected (the prebuild fails while it
> is set) so an old leaf value cannot silently land in `NSPinnedCAIdentities`, where it
> would never match and iOS would refuse every connection. Put CA/intermediate hashes in
> `TASKFLOW_API_SPKI_CA_PINS`, move leaf hashes you still want to
> `TASKFLOW_API_SPKI_LEAF_PINS`, and unset `TASKFLOW_API_SPKI_PINS`.

**Expiry is the safe failure mode (Android).** Pins stop being enforced after the
`expiration` date and Android falls back to ordinary certificate validation instead
of bricking the app. Ship a new build with fresh pins (and a later expiry) well
before then. iOS ATS pinning has no expiry attribute, which is another reason to pin
CA keys on iOS rather than leaf keys. `app.json` sets `updates.enabled: false`, so
there is no OTA path to rotate pins: a pin change always needs a store release.

Not verified in this repository: pinning behaviour on real Android/iOS devices
(requires native builds); the unit tests (`npm run test:security`) assert the
generated `network_security_config.xml`, the `Info.plist` entries and the merged
`AndroidManifest.xml` for both plugin orders.

To obtain an SPKI hash (works for a leaf, intermediate or root certificate PEM):
```bash
# From a live server's leaf certificate:
openssl s_client -connect api.example.com:443 </dev/null 2>/dev/null \
  | openssl x509 -pubkey -noout \
  | openssl pkey -pubin -outform DER \
  | openssl dgst -sha256 -binary \
  | openssl base64 -A

# From a CA/intermediate certificate file:
openssl x509 -in intermediate.pem -pubkey -noout \
  | openssl pkey -pubin -outform DER \
  | openssl dgst -sha256 -binary \
  | openssl base64 -A
```

---

## Directory Structure

```
mobile/
├── assets/                  # App icons, splash screens
├── e2e/                     # Detox E2E test suite (booking.e2e.test.ts, jest.config.js, README.md)
├── plugins/                 # Expo config plugins (withTaskflowTlsPinning.js — native SSL/TLS cert pinning)
├── src/
│   ├── api/                 # Axios REST API client layers
│   │   ├── client.ts
│   │   ├── auth.ts
│   │   ├── appointments.ts
│   │   ├── catalog.ts
│   │   ├── barbers.ts
│   │   ├── notifications.ts
│   │   ├── reviews.ts
│   │   ├── customer.ts
│   │   └── contracts.ts     # Runtime zod validation at the transport boundary
│   ├── components/          # Reusable UI components
│   │   ├── common/          # Button, Card, Input, Modal, Badge, LoadingIndicator, EmptyState, ErrorMessage, ErrorBoundary, ErrorState
│   │   ├── booking/         # StylistCard, TimeSlotPicker, ReceiptModal, PublicCancelModal, PublicReviewModal
│   │   └── lookbook/        # LookbookGallery
│   ├── hooks/               # TanStack Query custom hooks
│   ├── navigation/          # React Navigation Navigators (Guest, Customer, Admin, Root)
│   ├── query/                # TanStack Query client (queryClient.ts)
│   ├── screens/             # HomeScreen, BookingScreen, CatalogScreen, LookbookScreen, LoginScreen, RegisterScreen, PublicActionsScreen, CustomerPortalScreen, AdminDashboardScreen, AdminCatalogScreen, AdminSchedulesScreen, AdminNotificationsScreen
│   ├── store/               # Zustand state store (useAuthStore)
│   ├── theme/               # Gold & Obsidian palette, tokens, and colors
│   ├── types/               # TypeScript API models & Navigation ParamLists
│   └── utils/               # Secure storage (expo-secure-store), time utilities, idempotency keys
├── __tests__/               # Jest & React Native Testing Library unit test suites (49 suites)
├── .detoxrc.js              # Detox dual-platform E2E configuration (Android APK & iOS App)
├── App.tsx                  # Application entry point
├── app.json                 # Expo configuration
├── eas.json                 # EAS Build configuration (Android APK/AAB, iOS IPA)
├── metro.config.js          # Metro config: watches only ../shared, resolves node_modules from mobile/
└── package.json
```

## Testing Architecture & Quality Assurance

TaskFlow Mobile enforces a dual-layered testing strategy combining Unit/Component tests with End-to-End (E2E) automation:

### 1. Unit & Component Tests (Jest + RNTL)
* **Coverage:** 49 unit & component test suites (**100% PASS**).
* **Thresholds:** Enforced in `jest.config.js` (**>70%** across branches, functions, lines, and statements).
* **Stack:** `jest-expo` + `@testing-library/react-native` v14 + `test-renderer`.

### 2. End-to-End (E2E) Native Tests (Detox v20)
* **Scope:** Real native execution of Guest Booking Wizard and Guest Login flows (**9/9 PASSING**).
* **Binary Strategy:** Standalone Release builds with embedded JS bytecode bundles, eliminating Metro dev server dependency and touch-intercepting dev overlays during test runs.
* **Dual-Platform:** Tested on Android Emulator (`Pixel_6_API_35`) and iOS Simulator (`iPhone 17 Pro`).
* **Details:** See [`e2e/README.md`](e2e/README.md) for full architecture, device profiles, running commands, and scrolling/matching gotchas.

### 3. Runtime Performance Baseline

Expo SDK 58 uses React Native 0.88.0 with the New Architecture and Hermes V1 enabled by default. A production Android Metro export generated a Hermes bytecode bundle (`.hbc`) of 3,754,723 bytes (SDK 57 / RN 0.86.3: 3,399,015 bytes). Release builds run R8 (`android.enableMinifyInReleaseBuilds=true`, the SDK 58 template default).

Performance settings (BENCHMARKS.md §58):

- **React Compiler** is on (`app.json` `experiments.reactCompiler: true`; the Babel plugin ships with `babel-preset-expo`). It memoises components and hooks automatically, so new code should not add `useMemo`/`useCallback` only for render performance. The Jest suite passes with the compiler forced on.
- **Icons:** import one icon set per file (`import Ionicons from '@expo/vector-icons/Ionicons'`), never the `@expo/vector-icons` barrel: the barrel bundled every set's font (bundled assets 4.08 → 0.40 MB, Hermes bytecode 3.73 → 3.41 MB).
- **Zustand selectors** that return several fields use `useShallow`, so a store update re-renders only the screens whose fields changed.
- **Splash screen:** `RootNavigator` calls `SplashScreen.preventAutoHideAsync()` and hides it once `isBootstrapping` is false, so the first frame is the real screen instead of a blank one.
- **Release builds:** the `expo-build-properties` plugin sets `enableMinifyInReleaseBuilds` and `enableShrinkResourcesInReleaseBuilds` explicitly for Android, so R8 and resource shrinking no longer depend on template defaults.
- **Token reads:** the request interceptor reads the token and its expiry from secure storage in parallel (`Promise.all`); both cross the native bridge.

`react-native-reanimated` and `react-native-worklets` are not installed, so Worklets bundle mode is not applicable and its documented memory overhead does not affect this app. The application does not use `PerformanceObserver`.

Android edge-to-edge is handled by the Expo/RN SDK defaults, and the primary screens use `SafeAreaView`. Final inset and frame-time validation remains a device/emulator test requirement for Android 15+.

---

## Dependency Management

Expo owns the compatible versions for native dependencies. Renovate excludes
only the explicitly named Expo, React, React Native, React Native Web, and
native test packages in `package.json`; it does not dynamically discover every
module supported by the installed Expo SDK. Add a native dependency with
`npx expo install <package>` rather than `npm install`.

When upgrading Expo SDK, first select the target `expo` version, then align its
compatibility set and diagnose the project:

```bash
npx expo install --fix
npx expo install --check
npx expo-doctor
```

Commit `package.json` and `package-lock.json` together. Renovate continues to
manage ordinary libraries such as Axios, Zod, Zustand, TanStack Query, and React
Hook Form. React Navigation and native test tooling remain review-only grouped
updates because they carry React Native peer-dependency constraints.

### Vendored Security Patches (node-forge & braces)

TaskFlow vendors backports of upstream security fixes for two dependencies until published npm fixes are released:
1. **`node-forge@1.4.0` (CVE-2026-85393 / GHSA-86w9-cpqp-85rv):** Fixes RSA PKCS#1 v1.5 `DigestAlgorithm` validation.
2. **`braces@3.0.3` (CVE-2026-93687 / GHSA-vfj7-8cjw-p6xm):** Caps AST recursive parsing depth at `MAX_DEPTH = 100` to prevent call stack overflow crashes in Jest/micromatch.

Patches are applied via npm `overrides` using local `.tgz` archives in `mobile/vendor/`. This preserves `lockfileVersion: 3` (ensuring Renovate compatibility) and requires no install-time script execution (`npm ci --ignore-scripts` compatible).

> For detailed patch diffs, tarball rebuild scripts, test suites, and upstream removal procedures, see **[`mobile/vendor/README.md`](vendor/README.md)**.

---

## Development & Testing Commands

For the complete local setup and release workflow, see [`development-set.md`](development-set.md).

```bash
# Start Metro bundler / Expo CLI
npm start

# Run on Android Emulator or connected device
npm run android

# Run on iOS Simulator or connected device
npm run ios

# Run Jest unit & component tests (with coverage enforce)
npm test

# Typecheck TypeScript (0 errors)
npm run lint

# --- End-to-End (E2E) Testing with Detox ---

# Build Standalone Release APK & Test APK for Android E2E
npm run e2e:build:android

# Run Detox E2E Tests on Android Emulator (100% PASS)
npm run e2e:test:android

# Build Standalone Release App for iOS Simulator E2E
npm run e2e:build

# Run Detox E2E Tests on iOS Simulator
npm run e2e:test
```

## EAS Build & Distribution

> **Before first EAS build:** `app.json` → `extra.eas.projectId` contains a
> placeholder UUID (`11111111-2222-...`). Replace it with the real project ID from
> `npm install --global eas-cli`, then `eas login && eas init` (or the
> EAS web dashboard).
> OTA updates (`eas update`) will fail with an invalid projectId.
> `npm run check:eas` fails while the placeholder is still present, and
> `npm run build:android` / `npm run build:ios` run it first.

```bash
# Build Android Development APK
eas build --platform android --profile development

# Build Android Production AAB (Google Play Store)
eas build --platform android --profile production

# Build iOS Simulator Development build
eas build --platform ios --profile development

# Build iOS Production IPA (App Store / TestFlight)
eas build --platform ios --profile production
```
