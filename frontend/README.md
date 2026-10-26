# 🎨 TaskFlow Enterprise Frontend — Developer Guide

Welcome to the **TaskFlow Enterprise Frontend**! This client application is engineered with **Angular 22** utilizing the state-of-the-art **Angular Signals** architecture for Zone-free, lightweight, and modern state management.

The UI is custom-styled with **Tailwind CSS v4** in a premium enterprise **gold & obsidian** design system defined by the frontend-local `src/theme/tokens.json`.

---

## 🛠️ 1. Styling & Design System (Tailwind CSS v4)

This project uses **Tailwind CSS v4** (`^4.3.3`) natively within Angular 22's modern esbuild-based application compiler (`@angular/build:application`).

### Key Architecture Configuration Blocks:

1.  **PostCSS Settings (`.postcssrc.json`):** Instead of a legacy `tailwind.config.js`, Angular's native compiler processes PostCSS directly in the frontend root via this JSON settings block:
    ```json
    {
      "plugins": {
        "@tailwindcss/postcss": {}
      }
    }
    ```
2.  **Global Theme Variables (`src/styles.css`):** Imports Tailwind CSS v4 natively and declares custom brand colors defined by the frontend-local `src/theme/tokens.json`:

    ```css
    @import 'tailwindcss';

    /* Platform-local Theme Tokens: src/theme/tokens.json */
    @theme {
      --color-gold-light: #e5c185;
      --color-gold: #c5a059;
      --color-gold-dark: #8e7a5c;
      --color-obsidian-light: #1e293b;
      --color-obsidian: #090d16;
      --color-obsidian-dark: #030712;
      --color-status-pending: #fbbf24;
      --color-status-approved: #34d399;
      --color-status-denied: #f87171;
      --color-status-info: #3b82f6;
    }
    ```

3.  **Strict Content Security Policy (CSP) Inlining Optimization (`angular.json`):** Our hardened unprivileged production Nginx container implements a strict Content Security Policy (`script-src 'self'` plus the sha384 hashes of the inline scripts the `frontend/Dockerfile` inventory pins). Angular's critical CSS inlining loads the full stylesheet as `media="print"` and switches it on with inline script: an `onload` attribute before Angular 22, and in Angular 22 (Beasties `media-script`) an inline `<script>` appended to `<body>` plus a `data-beasties-media` attribute. The CSP blocks both, which leaves the page unstyled. On the client-rendered shell (`index.csr.html`, body only `<app-root>`) it would not help either: the "critical" CSS is 10 kB of theme variables and preflight, and nothing paints before the JavaScript runs. The prerendered guest landing (`index.html`) does paint before the JavaScript, so inlining could shorten its first paint, but only after the Beasties script is added to the hashed inline-script inventory and the gain is measured. Style inlining therefore stays disabled in `angular.json`, and CI checks both shells for the loader:
    ```json
    "optimization": {
      "styles": {
        "inlineCritical": false
      }
    }
    ```

---

## 🔁 2. Platform-local Contract Linkage

The frontend owns its contract files under `src/`:

- **API Types (`src/app/types/api.ts`)**: Generated from the reviewed root-level `api/openapi.json` baseline. Do not edit manually; use the workspace contract commands.
- **Pure Time Utilities (`src/app/time-utils.ts`)**: Owns pure time formatting and date validation functions.
- **Design Tokens (`src/theme/tokens.json`)**: Defines the frontend's Gold & Obsidian theme values used by `src/styles.css`.

---

## 🚀 3. Local Development & Setup

### API Contract Workflow

From the repository root, run `npm run sync:api-types` after the reviewed OpenAPI baseline changes. Use `npm run sync:api-types:check` to confirm this generated file is current. Backend API changes require `npm run api:spec:update` against a running local backend before regenerating types.

### Prerequisites

Make sure you have **Node.js 24.21.0** and **npm 12.2.1** installed. The
repository pins these versions through `mobile/.nvmrc` and
`frontend/package.json`.

### Setup and Start

To download dependencies and launch the local Angular development server on **`http://localhost:4200`**:

```bash
# From the repository root, install the local shared package first
cd shared/schemas
npm ci

# Navigate to the frontend directory and install locked dependencies
cd ../../frontend
npm ci

# Start the dev server
npm start
```

The shared package is referenced through `file:../shared/schemas`; installing
it first matches the CI setup and ensures its lockfile is honored. The Angular
application proxies API requests to `http://localhost:8080`, so start the
backend separately with `./gradlew bootRun` or start the full Docker stack.
The dev server bundles `@taskflow/schemas` with the app instead of prebundling it
(`prebundle.exclude` in `angular.json`): the package ships TypeScript sources, and
Vite's dependency optimizer could not resolve their extensionless imports, which
crashed `ng serve` on the first page load.

Install the browser required for frontend E2E tests once per machine:

```bash
cd frontend
npx playwright install chromium
# Linux workstations may use: npx playwright install --with-deps chromium
```

---

## 🧪 4. Quality Gates, Testing, & Formatting

We implement strict quality gates to guarantee compile-time and runtime compliance:

### A. Code Formatting (Prettier)

Our code formatter is configured with strict rules (100-character line width, single quotes, trailing commas).

- **Check code formatting:**
  ```bash
  npx prettier --check 'src/**/*.ts' 'src/**/*.html'
  ```
- **Automatically fix formatting:**
  ```bash
  npx prettier --write 'src/**/*.ts' 'src/**/*.html'
  ```

`npm run lint`, `npm run format` and `npm run format:check` keep their caches in
`node_modules/.cache/` (ESLint and Prettier results by file content, `tsc` incremental
build info), so a repeated run only re-checks what changed (lint ~10 s → ~5 s, format
check ~5 s → ~0.7 s). No rule needs type information, so a cached ESLint result cannot go
stale through another file; delete the directory to start cold.

### B. Unit Tests (Vitest)

Unit testing is executed via **Vitest** rather than heavy legacy Karma/Jasmine engines, allowing tests to run in milliseconds.

- **Run unit tests once:**
  ```bash
  npm test
  ```

### C. End-to-End Tests (Playwright)

Full-stack E2E testing is powered by **Playwright**.

- **Run Playwright E2E tests against an already running backend:**

  ```bash
  npm run e2e
  ```

  _Note: Ensure the backend is running (`./gradlew bootRun` or `./start-docker.sh`) before initiating `npm run e2e`._

- **Run Playwright E2E tests with automated Docker lifecycle:**
  ```bash
  npm run e2e:docker
  ```
  _Note: Automatically starts the full-stack Docker environment via `./start-docker.sh` and registers an exit hook (`./stop-docker.sh`) to tear down containers upon completion._

---

## 🏗️ 5. Production Asset Bundling

To compile and bundle the application into optimized, production-ready static assets:

```bash
npm run build
```

The resulting assets are generated in the `dist/` directory. These assets are then copied into our lightweight, unprivileged **Nginx web server container** (running on port `8080` to adhere to unprivileged port binding rules).

The build also **prerenders the guest landing** (`outputMode: "static"`, `src/main.server.ts`, `app.routes.server.ts`): `index.html` is the landing page's HTML, hydrated by the bundle, and `index.csr.html` is the client-rendered shell for every other route. Nothing calls the backend at build time: the public stores stay idle on the server (the empty lists the browser also shows while loading), the session bootstrap and CSRF fetch run only in the browser, and `PrerenderBackend` fails anything that slips through without a connection. The lookbook, FAQ and post-booking blocks use `@defer (… hydrate on idle)` (incremental hydration, which includes event replay), so they are part of the prerendered HTML; the lookbook's intro text is the LCP element. nginx serves `index.html` for `/` only to browsers without an `access_token` cookie (a signed-in user would otherwise see the guest page until the redirect) and `index.csr.html` for everything else, both `no-cache`. The frontend Dockerfile hashes every inline script of both pages (import map, event-replay contract and bootstrap) into the CSP and fails the image build if that inventory changes; `e2e/csp.spec.ts` re-hashes the served pages. Measured on slow 4G with 4× CPU throttling (median of 9, nginx 1.30.4): FCP 2,126 → 995 ms, LCP 2,440 → 1,644 ms (the hero text swapping to Inter), CLS 0; on a fast connection FCP 1,095 → 580 ms, LCP 1,340 → 580 ms. The hydration runtime costs +29 kB raw / +8.7 kB transfer of initial JavaScript.

The Angular 22 production chunk optimizer is enabled by default. The current measured baseline is **440.87 kB raw / 122.23 kB estimated transfer in 6 initial files** (the landing route is eager, BENCHMARKS.md §58/§63, plus the hydration runtime); the `any` budget (one chunk) is 250/300 kB against a largest chunk of ~201 kB. With `NG_BUILD_OPTIMIZE_CHUNKS=0` the same code ships as 14 initial files and 149.55 kB estimated transfer (before the landing route became eager the difference was 66 vs 126 kB). Keep `NG_BUILD_OPTIMIZE_CHUNKS` unset or enabled unless investigating a build issue.

---

## 📁 6. Key Architecture Conventions

- **Signals-Only State:** Component state, inputs, and outputs use native Angular Signals (`signal()`, `computed()`, `input()`, `model()`) instead of raw RxJS streams where applicable, eliminating Zone.js change-detection overhead.
- **Stateless JWT Cookie Authentication:** Auth state is managed via HttpOnly JWT cookies set by the backend. Role identity is restored into an in-memory Signal (`AuthState`) via `GET /api/v1/auth/me`.
- **Lazy-loaded Routes:** Feature dashboards (`/admin`, `/customer`) and the customer booking route (`/customer/book`) use lazy-loaded standalone components via `loadComponent()`, keeping the initial bundle small. The guest landing page (`''`) is eager (it is what every first visit renders, so lazy-loading the route only added a round trip). The booking wizard it embeds is **prerendered but deferred** — `@defer (on idle; hydrate on interaction)` — so its booking code and Signal Forms (~105 kB raw) are fetched on idle instead of riding in `main.js`, and hydrate on the first click, which event replay delivers (§63). Because a static import would pull Signal Forms back into the eager bundle, `landing-page.ts` must not import `BookingStore`: the lookbook hand-off goes through `LookbookSelectionBus`, a signal the store reads when it is constructed. Its login/register modals and the booking receipt use `@defer (… prefetch on idle)`. No global route preloading strategy is configured: opening the login modal prefetches the two dashboard chunks (`DashboardPrefetch`, `dashboard-loaders.ts`, shared with the routes), so the navigation after a login does not wait for its chunk. Change detection needs no provider: Angular 22 bootstraps zoneless and components default to OnPush. Browser targets are Angular's default (Baseline widely available, including iOS/Safari 17 and 18): a narrower `.browserslistrc` produced byte-identical JavaScript. The initial budget is 550 kB (warning) / 600 kB (error) in `angular.json`; the shared schemas use `zod/mini` to stay inside it (ADR-019). View transitions and in-memory scroll restoration are enabled via Angular's `withViewTransitions({ skipInitialTransition: true })` (no cross-fade on page load) and `withInMemoryScrolling()`.
