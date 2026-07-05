# 🎨 TaskFlow Enterprise Frontend — Developer Guide

Welcome to the **TaskFlow Enterprise Frontend**! This client application is engineered with **Angular 22** utilizing the state-of-the-art **Angular Signals** architecture for Zone-free, lightweight, and modern state management.

The UI is custom-styled with **Tailwind CSS v4** in a premium enterprise **gold & obsidian** design system.

---

## 🛠️ 1. Styling & Design System (Tailwind CSS v4)

This project uses **Tailwind CSS v4** (`^4.3.1`) natively within Angular 22's modern esbuild-based application compiler (`@angular/build:application`).

### Key Architecture Configuration Blocks:
1.  **PostCSS Settings (`.postcssrc.json`):** Instead of a legacy `tailwind.config.js`, Angular's native compiler processes PostCSS directly in the frontend root via this JSON settings block:
    ```json
    {
      "plugins": {
        "@tailwindcss/postcss": {}
      }
    }
    ```
2.  **Global Theme Variables (`src/styles.css`):** Imports Tailwind CSS v4 natively and declares the custom brand colors inside the modern `@theme` directive:
    ```css
    @import "tailwindcss";

    @theme {
      --color-gold-light: #e5c185;
      --color-gold: #c5a059;
      --color-gold-dark: #8e7a5c;
      --color-obsidian-light: #1e293b;
      --color-obsidian: #090d16;
      --color-obsidian-dark: #030712;
    }
    ```
3.  **Strict Content Security Policy (CSP) Inlining Optimization (`angular.json`):** Our hardened unprivileged production Nginx container implements a strict Content Security Policy (`style-src 'self' 'unsafe-inline'`). To prevent Angular's default critical CSS extraction tool from injecting dynamic `onload` script attributes (which are blocked by strict CSP, rendering the page unstyled), we explicitly disabled style inlining in `angular.json`:
    ```json
    "optimization": {
      "styles": {
        "inlineCritical": false
      }
    }
    ```

---

## 🚀 2. Local Development & Setup

### Prerequisites
Make sure you have **Node.js v22** and **npm v10+** installed.

### Setup and Start
To download dependencies and launch the local Angular development server on **`http://localhost:4200`**:

```bash
# Navigate to the frontend directory
cd frontend

# Install clean dependencies
npm ci

# Start the dev server
npm start
```

*Note: The Angular application is configured to proxy API requests to `http://localhost:8080` (Spring Boot) automatically during local development.*

---

## 🧪 3. Quality Gates, Testing, & Formatting

We implement strict quality gates to guarantee compile-time and runtime compliance:

### A. Code Formatting (Prettier)
Our code formatter is configured with strict rules (100-character line width, single quotes, trailing commas). 
*   **Check code formatting:**
    ```bash
    npx prettier --check 'src/**/*.ts' 'src/**/*.html'
    ```
*   **Automatically fix formatting:**
    ```bash
    npx prettier --write 'src/**/*.ts' 'src/**/*.html'
    ```

### B. Unit Tests (Vitest)
Unit testing is executed via **Vitest** rather than heavy legacy Karma/Jasmine engines, allowing tests to run in milliseconds.
*   **Run unit tests once:**
    ```bash
    npm test
    ```

### C. End-to-End Tests (Playwright)
Full-stack E2E testing is powered by **Playwright**.
*   **Run Playwright E2E tests:**
    ```bash
    npm run e2e
    ```
    *Note: Ensure the backend is running (`./gradlew bootRun`) before initiating the E2E tests, as Playwright executes real transactional flows against the Spring Boot database!*

---

## 🏗️ 4. Production Asset Bundling

To compile and bundle the application into optimized, production-ready static assets:

```bash
npm run build
```

The resulting assets are generated in the `dist/` directory. These assets are then copied into our lightweight, unprivileged **Nginx web server container** (running on port `8080` to adhere to unprivileged port binding rules).

---

## 📁 5. Key Architecture Conventions

*   **Signals-Only State:** Component state, inputs, and outputs use native Angular Signals (`signal()`, `computed()`, `input()`, `model()`) instead of raw RxJS streams where applicable, eliminating Zone.js change-detection overhead.
*   **Bearer JWT Interceptor:** The application stores active sessions in `sessionStorage`. The `auth.interceptor.ts` automatically intercepts every outgoing HttpClient request to attach the `Authorization: Bearer <Token>` header.
*   **Route Preloading:** Modern lazy-loading is coupled with the `PreloadAllModules` strategy, allowing the browser to download feature chunks in the background while the user is idle, delivering near-instant navigation speeds.
