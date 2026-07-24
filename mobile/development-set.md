# TaskFlow Mobile — Development Guide

This document covers how to run, test, and build the TaskFlow React Native + Expo mobile app on iOS and Android.

---

## Architecture

```
React Native (Expo)
  ├── TanStack Query   — server-state caching & mutations
  ├── Axios            — HTTP client → Spring Boot REST API
  ├── Zustand          — client state (auth, UI)
  ├── expo-secure-store — JWT storage (iOS Keychain / Android Keystore)
  └── React Navigation — bottom-tab + native-stack navigation

Spring Boot Backend
  ├── OAuth2 Resource Server (RSA-2048 JWT)
  ├── Bearer token accepted (cookieBearerTokenResolver fallback)
  └── CSRF auto-deferred for Bearer-token requests
```

**Important:** The app uses `expo-secure-store` which is a native module. Expo Go **cannot** run it — you must use a development build.

---

## Prerequisites

| Tool | Version | Verify |
|------|---------|--------|
| Node.js | LTS (>=22) | `node -v` |
| Xcode | >=16 | `xcodebuild -version` |
| CocoaPods | >=1.15 | `pod --version` |
| Docker | (for backend) | `docker ps` |

Install missing tools:

```bash
brew install node watchman cocoapods
sudo xcode-select -s /Applications/Xcode.app
sudo xcodebuild -license accept
```

---

## First-Time Setup

```bash
cd mobile

# Install JS dependencies (peer-deps workaround needed for react-test-renderer)
npm install --legacy-peer-deps

# Generate native iOS project + install CocoaPods
npx expo prebuild --platform ios
```

This creates the `ios/` directory with the Xcode workspace. It only needs to be done once (or after adding/removing native modules).

---

## Backend Connectivity

The mobile app connects to the Spring Boot backend. Configuration is in `.env`:

```
EXPO_PUBLIC_API_URL=http://localhost:8080
```

Copy `.env.example` → `.env` and adjust:

| Platform | Default | Override needed? |
|----------|---------|-------------------|
| iOS Simulator | `http://localhost:8080` | No (shares host network) |
| Android Emulator | `http://10.0.2.2:8080` | No (auto-detected) |
| Physical iPhone | — | **Yes** — set to your Mac's LAN IP |
| Physical Android | — | **Yes** — set to your Mac's LAN IP |

Find your Mac's LAN IP: `ifconfig | grep "inet " | grep -v 127.0.0.1`

The backend **must be running** before the mobile app. Start it first:

```bash
# From project root
./start-docker.sh
# or
docker compose up -d db redis backend
```

Verify the backend is reachable: `curl http://localhost:8080/api/v1/catalog`

---

## Running on iOS Simulator

### Step 1: Start the backend

```bash
./start-docker.sh          # from project root
```

### Step 2: Launch the app

```bash
cd mobile
npx expo run:ios           # full build + launch
```

For subsequent runs (no native changes), use the faster cached build:

```bash
npx expo start --ios       # launch with existing build
```

To open in Xcode directly:

```bash
open ios/TaskFlowMobile.xcworkspace   # note: .xcworkspace, NOT .xcodeproj
```

Then press ▶️ in Xcode.

---

## Running on Android Emulator

```bash
cd mobile
npx expo prebuild --platform android   # first time only
npx expo run:android                   # build + launch
```

---

## Hot Reload

Metro bundler watches for changes and reloads automatically. The keyboard shortcuts inside the simulator:

| Shortcut | Action |
|----------|--------|
| `Cmd + R` (iOS) / `rr` (Android) | Reload |
| `Cmd + D` (iOS) / `Cmd + M` (Android) | Dev menu |
| `j` in Metro terminal | Open React Native DevTools |

---

## Stopping

### Expo / Metro bundler
Press `Ctrl+C` in the terminal running Expo. This stops the Metro bundler and dev server.

### iOS Simulator
```bash
# Graceful quit
osascript -e 'quit app "Simulator"'

# Or shut down all simulators
xcrun simctl shutdown all
```

You can also just `Cmd+Q` on the Simulator window.

**If the dock icon won't go away:** this is macOS keeping recently used apps in the dock — the Simulator is already quit. Right-click the icon → **Options** → **Remove from Dock**. Or disable it system-wide: System Settings → Desktop & Dock → uncheck **"Show recent applications in Dock"**.

### Android Emulator
```bash
# Kill the running emulator (use full path if adb isn't in PATH)
~/Library/Android/sdk/platform-tools/adb emu kill

# Or shut down all emulators
~/Library/Android/sdk/platform-tools/adb devices | grep emulator | cut -f1 | while read line; do ~/Library/Android/sdk/platform-tools/adb -s $line emu kill; done
```

To make `adb` available directly, add the SDK to your PATH:
```bash
echo 'export PATH="$HOME/Library/Android/sdk/platform-tools:$HOME/Library/Android/sdk/emulator:$PATH"' >> ~/.zshrc
```

### Backend (Docker)
```bash
# From project root
./stop-docker.sh
# or
docker compose down
```

---

## Running Tests

```bash
npm test                 # run once
npm run test:watch       # watch mode
npm run lint             # TypeScript type-check (tsc --noEmit)
```

---

## Production Builds

Production builds use EAS (Expo Application Services):

```bash
npm run build:android    # eas build --platform android
npm run build:ios        # eas build --platform ios
```

Build profiles are defined in `eas.json`:
- `development` — development client, simulator builds
- `preview` — internal distribution (TestFlight / APK)
- `production` — store submission (AAB / IPA)

---

## Common Issues

### "expo: command not found"
Expo is not installed globally. Always use `npx expo`.

### "expo-secure-store" not working
You're likely running Expo Go. This app requires a **development build** (`npx expo run:ios`).

### Build fails after adding/removing dependencies
```bash
npx expo prebuild --clean --platform ios
cd ios && pod install
```

### App shows blank/white screen
The backend is probably unreachable. Check:
1. `docker compose ps` — is the backend running?
2. `curl http://localhost:8080/api/v1/catalog` — does it respond?
3. `.env` — is `EXPO_PUBLIC_API_URL` correct for your environment?

### Metro bundler port conflict
If port 8081 is in use:
```bash
npx expo start --port 8082
```

### Haptic pattern warnings in simulator logs
```
CHHapticPattern: Failed to read "hapticpatternlibrary.plist"
```
Harmless — the iOS Simulator doesn't include haptic feedback files. Ignore.

### Package version warnings
```
react-native@0.76.5 - expected version: 0.76.9
```
Non-blocking. The current versions work. Update when convenient via `npx expo install --fix`.

---

## Project Structure

```
mobile/
├── src/
│   ├── api/            # Axios API client + endpoint modules
│   ├── components/     # Reusable UI components
│   │   ├── booking/    # Appointment booking widgets
│   │   ├── common/     # Button, Card, Input, Modal, etc.
│   │   └── lookbook/   # Style gallery
│   ├── hooks/          # TanStack Query hooks
│   ├── navigation/     # React Navigation (Root, Guest, Customer, Admin)
│   ├── screens/        # Full-screen views
│   ├── store/          # Zustand stores (auth, UI)
│   ├── theme/          # Color constants
│   ├── types/          # TypeScript interfaces
│   └── utils/          # SecureStore wrapper
├── __tests__/          # Jest test files
├── assets/             # App icons, splash screen
├── ios/                # Native Xcode project (generated)
├── android/            # Native Android project (generated)
├── .env                # Local environment (git-ignored)
├── .env.example        # Environment template
├── app.json            # Expo configuration
├── eas.json            # EAS Build profiles
└── package.json
```
