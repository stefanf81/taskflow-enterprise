---
name: sync-to-mobile
description: Synchronizes feature, UI, or design changes made in the Angular 22 Web Frontend (@frontend/) to the React Native Expo Mobile App (@mobile/).
---

# Feature & UI Sync Workflow: Web Frontend (@frontend/) -> Mobile (@mobile/)

Use this skill when a user asks to port or synchronize a new feature, component modification, or design update from the Angular 22 Web Frontend (`frontend/`) to the React Native Expo Mobile app (`mobile/`).

## Feature Component Mapping Matrix
Refer to `frontend/src/component-map.json` or `mobile/src/component-map.json` to identify exact target files for each feature domain:
* **Stylist Cards**: `frontend/src/app/components/stylist-card/stylist-card.ts` ↔ `mobile/src/components/booking/StylistCard.tsx`
* **Booking Wizard**: `frontend/src/app/app.ts` / `app.html` ↔ `mobile/src/screens/BookingScreen.tsx`
* **Customer Portal**: `frontend/src/app/features/customer/` ↔ `mobile/src/screens/CustomerPortalScreen.tsx`
* **Admin Dashboard**: `frontend/src/app/features/admin/` ↔ `mobile/src/screens/AdminDashboardScreen.tsx`
* **Lookbook**: `frontend/src/app/components/lookbook/` ↔ `mobile/src/screens/LookbookScreen.tsx`

## Architectural Translation Rules

### 1. State Management & Data Fetching
* **Angular Signals & Stores (`*.store.ts`)**:
  * Angular 22 uses `signal()`, `computed()`, and RxJS stores.
  * Map these to React Native **TanStack Query** custom hooks (`mobile/src/hooks/use*.ts`) for server state, or **Zustand** (`mobile/src/store/use*.ts`) for client state.
* API contracts are kept in `frontend/src/app/types/api.ts` and `mobile/src/types/api.ts` (sync via `npm run sync:api-types`).

### 2. UI Component Structure
* **Angular HTML Templates (`*.html` or inline)**:
  * `@if (condition)` -> `{condition ? <View>...</View> : null}`
  * `@for (item of items)` -> `<FlatList data={items} ... />` or `items.map(...)` inside `<ScrollView>`
  * `<button>` -> `<TouchableOpacity>` or `<Button>` from `mobile/src/components/common/Button.tsx`
  * `<input>` -> `<Input>` from `mobile/src/components/common/Input.tsx`

### 3. Design System & Theme Tokens
* Colors are synchronized via the platform-local `frontend/src/theme/tokens.json` and `mobile/src/theme/tokens.json`.
* Always use theme tokens from `mobile/src/theme/colors.ts`:
  * Obsidian Slate: `colors.obsidian.bg`, `colors.obsidian.card`, `colors.obsidian.surface`
  * Gold Metallic: `colors.gold.main`, `colors.gold.bright`, `colors.gold.dim`, `colors.gold.border`
  * Status Badges: `colors.status.pending`, `colors.status.approved`, `colors.status.denied`, `colors.status.info`

### 4. Verification Workflow
After updating `mobile/`:
1. Run type checks: `npm run lint:all`
2. Run test suite: `npm run test:all`
3. If new tests are needed for the updated screen/component, add them under `mobile/__tests__/`.
