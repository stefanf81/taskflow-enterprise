# Frontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.0.3.

## Styling & Design System (Tailwind CSS v4)

This project uses **Tailwind CSS v4** (`^4.3.1`) natively within Angular 22's esbuild-based application compiler (`@angular/build:application`). 

### Core Configurations:
1. **`.postcssrc.json`:** Rather than `tailwind.config.js` or `postcss.config.js`, Angular's native compiler requires a JSON-based PostCSS settings block in the frontend root:
   ```json
   {
     "plugins": {
       "@tailwindcss/postcss": {}
     }
   }
   ```
2. **`styles.css`:** Imports Tailwind CSS v4 natively and declares the custom brand variables inside the `@theme` directive:
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
3. **`angular.json` Optimization Flag:** The production unprivileged Nginx container implements a strict Content Security Policy (`style-src 'self' 'unsafe-inline'`). To prevent Angular's default critical CSS extraction tool from injecting dynamic `onload` script attributes (which get blocked by the CSP and render the page unstyled), we explicitly disable style inlining inside `angular.json`:
   ```json
   "optimization": {
     "styles": {
       "inlineCritical": false
     }
   }
   ```

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
