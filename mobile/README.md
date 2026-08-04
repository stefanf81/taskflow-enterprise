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

* **API Types (`src/types/api.ts`)**: Owns API contracts synced with Spring Boot OpenAPI via `npm run sync:api-types`.
* **Design System (`src/theme/colors.ts`)**: Imports theme tokens (`obsidian`, `gold`, `status`, `text`) from `src/theme/tokens.json`.
* **Pure Time Utilities (`src/utils/time-utils.ts`)**: Owns pure 12h/24h time formatting and `isOverdue` calculations.

---

## Backend Connectivity & Security Model

The mobile app connects to the Spring Boot REST API (`taskflow-backend`).

### Local Development Setup (`mobile/.env`)
* **iOS Simulator**: `http://localhost:8080`
* **Android Emulator**: `http://10.0.2.2:8080` (or leave `EXPO_PUBLIC_API_URL` empty for auto-detection)
* **Physical Device**: `http://<YOUR_MAC_LAN_IP>:8080`

### Production Connection
To connect local simulators, emulators, or production builds to a live production backend:
```bash
# Override API URL directly when starting Metro
EXPO_PUBLIC_API_URL=https://api.yourdomain.com npx expo start -c
```
Production environments enforce TLS/HTTPS encryption, hardware token encryption in **iOS Keychain** / **Android Keystore** via `expo-secure-store`, and Redis IP rate-limiting.

---

## Directory Structure

```
mobile/
├── assets/                  # App icons, splash screens
├── e2e/                     # Detox E2E test suite (booking.e2e.test.ts, jest.config.js, README.md)
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
│   ├── components/          # Reusable UI components
│   │   ├── common/          # Button, Card, Input, Modal, Badge, LoadingIndicator, EmptyState, ErrorMessage
│   │   ├── booking/         # StylistCard, TimeSlotPicker, ReceiptModal, PublicCancelModal, PublicReviewModal
│   │   └── lookbook/        # LookbookGallery
│   ├── hooks/               # TanStack Query custom hooks
│   ├── navigation/          # React Navigation Navigators (Guest, Customer, Admin, Root)
│   ├── screens/             # HomeScreen, BookingScreen, CatalogScreen, LookbookScreen, LoginScreen, RegisterScreen, PublicActionsScreen, CustomerPortalScreen, AdminDashboardScreen, AdminCatalogScreen, AdminSchedulesScreen, AdminNotificationsScreen
│   ├── store/               # Zustand state store (useAuthStore)
│   ├── theme/               # Gold & Obsidian palette, tokens, and colors
│   ├── types/               # TypeScript API models & Navigation ParamLists
│   └── utils/               # Secure storage, time utilities, and optional SSL pinning
├── __tests__/               # Jest & React Native Testing Library unit test suites (351 tests, 48 suites)
├── .detoxrc.js              # Detox dual-platform E2E configuration (Android APK & iOS App)
├── App.tsx                  # Application entry point
├── app.json                 # Expo configuration
├── eas.json                 # EAS Build configuration (Android APK/AAB, iOS IPA)
├── metro.config.js          # Metro bundler configuration with monorepo resolution
└── package.json
```

## Testing Architecture & Quality Assurance

TaskFlow Mobile enforces a dual-layered testing strategy combining Unit/Component tests with End-to-End (E2E) automation:

### 1. Unit & Component Tests (Jest + RNTL)
* **Coverage:** 351 unit & component tests across 48 test suites (**100% PASS**).
* **Thresholds:** Enforced in `jest.config.js` (**>70%** across branches, functions, lines, and statements).
* **Stack:** `jest-expo` + `@testing-library/react-native` v14 + `test-renderer`.

### 2. End-to-End (E2E) Native Tests (Detox v20)
* **Scope:** Real native execution of Guest Booking Wizard and Guest Login flows (**9/9 PASSING**).
* **Binary Strategy:** Standalone Release builds with embedded JS bytecode bundles, eliminating Metro dev server dependency and touch-intercepting dev overlays during test runs.
* **Dual-Platform:** Tested on Android Emulator (`Pixel_6_API_35`) and iOS Simulator (`iPhone 17 Pro`).

---

## Development & Testing Commands

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
> placeholder UUID. Replace it with the real project ID from
> `npx eas-cli login && npx eas-cli project:init` (or the EAS web dashboard).
> OTA updates (`eas update`) will fail with an invalid projectId.

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
