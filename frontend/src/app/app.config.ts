import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  provideHttpClient,
  withFetch,
  withInterceptors,
  withXsrfConfiguration,
} from '@angular/common/http';
import { provideRouter, withInMemoryScrolling, withViewTransitions } from '@angular/router';
import { catchError, of, timeout } from 'rxjs';

import { authInterceptor } from './auth.interceptor';
import { AuthApi } from './core/api/auth-api';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    // Surface uncaught errors (including from effects) to the browser console.
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),

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
    provideAppInitializer(() => {
      inject(AuthApi)
        .fetchCsrfToken()
        .pipe(
          timeout(5000),
          catchError(() => of(void 0)),
        )
        .subscribe();
    }),
  ],
};
