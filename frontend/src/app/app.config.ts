import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideClientHydration, withIncrementalHydration } from '@angular/platform-browser';
import {
  provideHttpClient,
  withFetch,
  withInterceptors,
  withXsrfConfiguration,
} from '@angular/common/http';
import { provideRouter, withInMemoryScrolling, withViewTransitions } from '@angular/router';
import { catchError, of, retry, timeout } from 'rxjs';

import { authInterceptor } from './auth.interceptor';
import { AuthApi } from './core/api/auth-api';
import { isServerRender } from './core/platform';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    // Surface uncaught errors (including from effects) to the browser console.
    provideBrowserGlobalErrorListeners(),
    // No change-detection provider: Angular 22 bootstraps zoneless and components default to
    // OnPush (`ChangeDetectionStrategy.Eager` would opt one out).

    // The guest landing is prerendered (app.routes.server.ts): reuse its DOM instead of rendering
    // it again. Incremental hydration also renders the `@defer (… hydrate on idle)` blocks on the
    // server and hydrates them when their trigger fires; it includes event replay, which replays
    // clicks made before the code that handles them has loaded. Pages rendered in the browser
    // (index.csr.html carries `ngcm`) skip hydration.
    provideClientHydration(withIncrementalHydration()),

    provideRouter(
      routes,
      withViewTransitions(),
      withInMemoryScrolling({
        scrollPositionRestoration: 'enabled',
        anchorScrolling: 'enabled',
      }),
    ),

    provideHttpClient(
      withFetch(),
      withInterceptors([authInterceptor]),
      withXsrfConfiguration({
        cookieName: 'XSRF-TOKEN',
        headerName: 'X-XSRF-TOKEN',
      }),
    ),
    // Protected mutations need the readable double-submit cookie before Angular
    // attaches X-XSRF-TOKEN. The fetch is started but NOT awaited: blocking
    // bootstrap on it held first render for up to the timeout on slow networks
    // for no benefit — Angular reads the cookie when the first mutation is sent.
    // Failures are retried (twice, with a short pause) so one slow/failed boot request
    // does not leave the session without a CSRF cookie; AuthState.logout() additionally
    // refetches the token itself when the server answers 403.
    // Not while prerendering: there is no backend at build time.
    provideAppInitializer(() => {
      if (isServerRender()) return;
      inject(AuthApi)
        .fetchCsrfToken()
        .pipe(
          timeout(5000),
          retry({ count: 2, delay: 1500 }),
          catchError(() => of(void 0)),
        )
        .subscribe();
    }),
  ],
};
