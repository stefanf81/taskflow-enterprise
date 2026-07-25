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

## 🔁 Shared Single Source of Truth Linkage

The mobile app links directly into the workspace-level `shared/` contract directory:

* **API Types (`src/types/api.ts`)**: Re-exports unified API contracts from `shared/types/api.ts` (synced with Spring Boot OpenAPI via `npm run sync:api-types`).
* **Design System (`src/theme/colors.ts`)**: Dynamically imports theme tokens (`obsidian`, `gold`, `status`, `text`) from `shared/theme/tokens.json`.
* **Pure Time Utilities (`src/utils/time-utils.ts`)**: Re-exports pure 12h/24h time formatting and `isOverdue` calculations from `shared/utils/time-utils.ts`.

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
├── src/
│   ├── api/                 # Axios REST API client layers
│   │   ├── client.ts
│   │   ├── auth.ts
│   │   ├── appointments.ts
│   │   ├── catalog.ts
│   │   ├── barbers.ts
│   │   ├── notifications.ts
│   │   ├── reviews.ts
│   │   └── customer.ts
│   ├── components/          # Reusable UI components
│   │   ├── common/          # Button, Card, Input, Modal, Badge, LoadingIndicator, EmptyState, ErrorMessage
│   │   ├── booking/         # StylistCard, TimeSlotPicker, ReceiptModal, PublicCancelModal, PublicReviewModal
│   │   └── lookbook/        # LookbookGallery
│   ├── hooks/               # TanStack Query custom hooks
│   ├── navigation/          # React Navigation Navigators (Guest, Customer, Admin, Root)
│   ├── screens/             # HomeScreen, BookingScreen, CatalogScreen, LookbookScreen, LoginScreen, RegisterScreen, PublicActionsScreen, CustomerPortalScreen, AdminDashboardScreen, AdminCatalogScreen, AdminSchedulesScreen, AdminNotificationsScreen
│   ├── store/               # Zustand state stores (useAuthStore, useUIStore)
│   ├── theme/               # Gold & Obsidian palette & colors (imports shared/theme/tokens.json)
│   ├── types/               # TypeScript models (re-exports shared/types/api.ts) & Navigation ParamLists
│   └── utils/               # SecureStorage wrapper & time-utils (re-exports shared/utils/time-utils.ts)
├── __tests__/               # Jest & React Native Testing Library test suites
├── App.tsx                  # Application entry point
├── app.json                 # Expo configuration
├── eas.json                 # EAS Build configuration (Android APK/AAB, iOS IPA)
└── package.json
```

## Development Commands

```bash
# Start Metro bundler / Expo CLI
npm start

# Run on Android Emulator or connected device
npm run android

# Run on iOS Simulator or connected device
npm run ios

# Run Jest unit & component tests
npm test

# Typecheck TypeScript
npm run lint
```

## EAS Build & Distribution

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
