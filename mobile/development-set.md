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
  ├── JWT in HttpOnly `access_token` cookie (with Bearer header fallback)
  └── CSRF double-submit cookie pattern — `XSRF-TOKEN` cookie + `X-XSRF-TOKEN` header required on all POST/PUT/DELETE (except public guest endpoints)
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

# Install locked JS dependencies. mobile/.npmrc records the required peer
# compatibility setting for @config-plugins/detox@11.0.0 with Expo 57.
npm ci

# Generate native iOS project + install CocoaPods
npx expo prebuild --platform ios
```

This creates the `ios/` directory with the Xcode workspace. It only needs to be done once (or after adding/removing native modules).

The generated `ios/` directory, including `Podfile.lock`, is ignored by Git. CocoaPods
therefore uses the lockfile locally when present, while clean CI runs resolve pods with
`pod install --no-repo-update` and report that the pod graph is not fully locked.

---

## Backend Connectivity & Security Model

The mobile app connects to the Spring Boot backend (`taskflow-backend`).

### 1. Backend Security Architecture (Zero-Trust)

The backend is secured using enterprise-grade DevSecOps controls:
* **Network Isolation**: The database (`taskflow-db`) and cache (`taskflow-redis`) are strictly isolated on an internal `backend-tier` network. Only `taskflow-backend` bridges the `frontend-tier` and `backend-tier`.
* **Stateless Asymmetric JWT (RSA-2048)**: Requests to protected endpoints must present an asymmetric RSA-2048 signed token via `Authorization: Bearer <token>`.
* **Role-Based Access Control (RBAC)**: Public guest endpoints (`GET /api/v1/catalog`, `GET /api/v1/barbers`, `POST /api/v1/auth/login`) are open. Admin endpoints (`/api/v1/notifications/**`, catalog/staff management) strictly require `ROLE_ADMIN`.
* **Redis-Backed Rate Limiting**: All client IPs are rate-limited per minute (capped at 20 req/min on `/api/v1/auth/*`) to prevent brute-force attacks and DoS.
* **Double-Submit CSRF**: State-changing endpoints (`POST`, `PUT`, `DELETE`) require a matching `X-XSRF-TOKEN` header validated against the `XSRF-TOKEN` cookie (auto-fetched lazily by `src/api/client.ts`).
* **Container Hardening**: Unprivileged numeric user (`10001:10001`), read-only root filesystem (`read_only: true`), and complete Linux capability dropping (`cap_drop: [ALL]`).

---

### 2. Local Backend Connectivity Matrix

Configuration is defined in `mobile/.env`:

```env
EXPO_PUBLIC_API_URL=http://localhost:4200
```

| Platform / Environment | Recommended `EXPO_PUBLIC_API_URL` | Override Needed? | Notes |
|:---|:---|:---|:---|
| **iOS Simulator** | `http://localhost:4200` | No | Uses the local Nginx ingress. |
| **Android Emulator** | `http://10.0.2.2:4200` | Optional | `client.ts` auto-detects Android and uses `10.0.2.2` if `EXPO_PUBLIC_API_URL` is omitted. |
| **Physical iPhone / Android** | `http://<MAC_LAN_IP>:4200` | **Yes** | Replace with your computer's local Wi-Fi IP (e.g. `http://192.168.1.50:4200`). |

Find your Mac's LAN IP: `ifconfig | grep "inet " | grep -v 127.0.0.1`

The backend **must be running** before launching the mobile app:

```bash
# From project root
./start-docker.sh
# or
docker compose up -d db redis backend
```

Verify API reachability: `curl http://localhost:4200/api/v1/catalog`

---

### 3. Connecting Simulators & Mobile Apps to Production

To connect iOS Simulators, Android Emulators, or production mobile builds to a **Production Environment** (e.g., `https://api.taskflow.example.com`):

#### Method A: Local `.env` Override (Quickest for Local Simulators)
1. Edit `mobile/.env`:
   ```env
   EXPO_PUBLIC_API_URL=https://api.taskflow.example.com
   ```
2. Clear the Metro cache and launch Expo:
   ```bash
   npx expo start -c
   ```
3. Press `i` (iOS Simulator) or `a` (Android Emulator).

#### Method B: One-Time CLI Override
```bash
EXPO_PUBLIC_API_URL=https://api.taskflow.example.com npx expo start -c
```

#### Method C: EAS Build Profiles (`eas.json`)
For standalone production builds or preview binaries shared with testers, configure the environment variable in `mobile/eas.json`:

```json
"preview": {
  "distribution": "internal",
  "env": {
    "EXPO_PUBLIC_API_URL": "https://api.taskflow.example.com"
  }
},
"production": {
  "distribution": "store",
  "env": {
    "EXPO_PUBLIC_API_URL": "https://api.taskflow.example.com"
  }
}
```

Trigger the build:
```bash
eas build --profile preview --platform ios
```

#### Production Security Requirements:
1. **Valid HTTPS / TLS Certificate**: Production backends must serve a valid TLS certificate (e.g., Let's Encrypt / Cloudflare). iOS App Transport Security (ATS) and Android Network Security block plain HTTP or invalid/self-signed SSL certificates in production builds.
2. **Hardware Enclave Tokens**: Production builds store session JWTs in hardware-encrypted storage (`expo-secure-store` via iOS **Keychain** / Android **Keystore**).
3. **Production Credentials**: Use production database credentials (e.g., admin user generated at deployment), as local H2/dev seed data will not exist in production.

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

### 1. Unit & Component Tests (Jest + RNTL)

```bash
npm test                 # run once with coverage check (336 tests, 47 suites)
npm run test:watch       # watch mode
npm run lint             # TypeScript type-check (tsc --noEmit)
```

Enforces **>70% coverage** across branches, functions, lines, and statements in `jest.config.js`.

---

### 2. End-to-End (E2E) Native Testing (Detox v20)

Detox E2E tests run on standalone Release binaries containing pre-compiled JavaScript bytecode bundles (no Metro server or dev-client overlays required during execution).

#### Prerequisites:
- **Android:** JDK 21 (`/opt/homebrew/opt/openjdk@21`) and Android SDK with emulator AVD `Pixel_6_API_35`.
- **iOS:** Xcode >=16, CocoaPods (iOS 16.4 deployment target), and `applesimutils` (`brew install wix/brew/applesimutils`).

#### Android E2E Commands:
```bash
# 1. Build Standalone Release APK and Test APK (JDK 21)
npm run e2e:build:android

# 2. Run Detox E2E tests on Android Emulator
npm run e2e:test:android
```

#### iOS E2E Commands:
```bash
# 1. Build Standalone Release App Bundle for iOS Simulator
npm run e2e:build

# 2. Build Detox framework cache (one-time)
npx detox build-framework-cache

# 3. Run Detox E2E tests on iOS Simulator
npm run e2e:test
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
2. `curl http://localhost:4200/api/v1/catalog` — does it respond?
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
react-native@0.86.0 - expected version: 0.86.x
```
This indicates an SDK compatibility mismatch. Run `npx expo install --fix`, then
verify with `npx expo install --check` and `npx expo-doctor` before building.

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
