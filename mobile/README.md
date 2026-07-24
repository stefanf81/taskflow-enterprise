# TaskFlow Mobile Application

A cross-platform mobile application for TaskFlow built with **React Native**, **Expo**, **TypeScript**, and **NativeWind** (Tailwind CSS). Runs natively on **Android** (phones & tablets) and **iOS** (iPhone & iPad).

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

## Stack Overview

* **Framework:** React Native, Expo ~52, TypeScript
* **Navigation:** `@react-navigation/native`, `@react-navigation/bottom-tabs`, `@react-navigation/native-stack`
* **API Layer:** Axios with Bearer token & cookie support (`src/api/client.ts`)
* **Server State:** TanStack Query (`@tanstack/react-query`) for all backend data (appointments, catalog, barbers, time-offs, notifications, reviews)
* **Client App State:** Zustand (`useAuthStore`, `useUIStore`)
* **Styling:** NativeWind / Tailwind CSS with Gold & Obsidian luxury salon design system
* **Forms & Validation:** `react-hook-form` & `zod`
* **Secure Token Storage:** `expo-secure-store` (iOS Keychain / Android Keystore)
* **Testing:** Jest, React Native Testing Library (`@testing-library/react-native`)
* **Build Services:** Expo Application Services (EAS Build) (`eas.json`)

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
│   ├── theme/               # Gold & Obsidian palette & colors
│   ├── types/               # TypeScript models & Navigation ParamLists
│   └── utils/               # SecureStorage wrapper
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
