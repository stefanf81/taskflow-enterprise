# ADR-006: Migration to React Native & Expo Mobile Application

**Status:** Accepted

## Context

TaskFlow's web frontend was built with Angular. To expand TaskFlow to mobile users on both Android (phones and tablets) and iOS (iPhone and iPad), a cross-platform mobile strategy was evaluated:

1. **Separate Native Applications (Kotlin for Android, Swift for iOS):** Highest platform native fidelity, but requires dual codebases, double development overhead, and duplicated API client/logic logic.
2. **Hybrid Web View Wrappers (Ionic/Capacitor):** Reuses the existing Angular web app inside a WebView container, but results in non-native UI feel, sluggish gesture performance, and limited native device capabilities.
3. **Cross-Platform React Native + Expo Framework:** One single TypeScript codebase compiling to native UI components on both iOS and Android, leveraging Expo's modern build pipeline (EAS) and Expo modules.

## Decision

Migrate the mobile application experience into a standalone **React Native + Expo** cross-platform mobile application located in `mobile/`.

Key technological choices in `mobile/`:

1. **Expo SDK 57 & React Native 0.86+ with TypeScript:** Built using Expo managed workflow with TypeScript for 100% type safety across mobile screens, navigation params, and API payloads.
2. **React Navigation 7:** Provides native stack navigation (`@react-navigation/native-stack`) and bottom tabs (`@react-navigation/bottom-tabs`) with smooth native transitions and gesture support.
3. **TanStack Query (`@tanstack/react-query`) for Server State:** All backend server state (appointments, service catalog, barbers, time-off, notifications, reviews) is fetched, cached, and synchronized using TanStack Query.
4. **Zustand for Client Application State:** Client-side state (authentication credentials, theme preferences, search query, active booking wizard steps) is isolated using Zustand stores (`useAuthStore`, `useUIStore`).
5. **Secure Storage via `expo-secure-store`:** JWT authentication tokens and user credentials are saved directly into platform secure hardware storage (**iOS Keychain** and **Android Keystore**).
6. **React Native `StyleSheet` Styling with Theme Tokens:** Styling uses `StyleSheet` with color tokens sourced from `mobile/src/theme/tokens.json` (Gold & Obsidian luxury palette) to maintain design system consistency with the web application.
7. **React Hook Form & Zod:** Form input handling and client-side validation schemas.
8. **EAS Build Support (`eas.json`):** Pre-configured build profiles for Android development APK, production AAB (Google Play Store), iOS Simulator, and production IPA (TestFlight / Apple App Store).

## Consequences

### Positive
- **Single Shared Codebase:** 100% code reuse for UI components, business logic, validation, and API integration across Android and iOS.
- **Native Performance:** Renders true native UI elements (not WebViews), ensuring 60 FPS transitions and native touch interactions.
- **Instant Backend Compatibility:** Communicates directly with the existing Spring Boot REST API without requiring backend schema changes.
- **Hardware Security:** Leverages platform keystores for JWT token storage.
- **Simplified CI/CD:** Continuous builds managed seamlessly via Expo Application Services (EAS Build).

### Negative
- **Additional Directory Maintenance:** Requires maintaining the `mobile/` project alongside the Spring Boot backend and Angular web frontend.
- **Platform Specific Testing:** E2E testing on real devices/emulators requires Expo development builds.
