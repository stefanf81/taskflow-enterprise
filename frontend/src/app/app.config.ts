import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideClientHydration } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors, withXsrfConfiguration } from '@angular/common/http';
import {
  NavigationEnd,
  Router,
  provideRouter,
  withInMemoryScrolling,
  withViewTransitions,
} from '@angular/router';
import { catchError, filter, firstValueFrom, map, of, retry, take, timeout } from 'rxjs';

import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthApi } from './core/api/auth-api';
import { requestTimeoutInterceptor } from './core/http/request-timeout.interceptor';
import { isServerRender } from './core/platform';
import { telemetryRoute } from './core/telemetry/client-telemetry';
import { TelemetryErrorHandler, TelemetryService } from './core/telemetry/telemetry.service';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    // Surface uncaught errors (including from effects) to the browser console.
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: TelemetryErrorHandler },
    // No change-detection provider: Angular 22 bootstraps zoneless and components default to
    // OnPush (`ChangeDetectionStrategy.Eager` would opt one out).

    // The guest landing is prerendered (app.routes.server.ts): reuse its DOM instead of rendering
    // it again. Incremental hydration (on by default since Angular 22; `withIncrementalHydration()`
    // is deprecated) also renders the `@defer (… hydrate on idle)` blocks on the server and
    // hydrates them when their trigger fires; it includes event replay, which replays clicks made
    // before the code that handles them has loaded. Pages rendered in the browser (index.csr.html
    // carries `ngcm`) skip hydration.
    provideClientHydration(),

    provideRouter(
      routes,
      // No transition for the initial navigation: it would snapshot the freshly loaded (or
      // prerendered) page and cross-fade it into an identical state while hydration waits.
      withViewTransitions({ skipInitialTransition: true }),
      withInMemoryScrolling({
        scrollPositionRestoration: 'enabled',
        anchorScrolling: 'enabled',
      }),
    ),

    // FetchBackend is the default HttpBackend in Angular 22 (`withFetch()` is deprecated).
    provideHttpClient(
      withInterceptors([requestTimeoutInterceptor, authInterceptor]),
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
      const router = inject(Router);
      // CONFIG route templates only (never router.url), read when a value is recorded. The
      // initializer runs before the first navigation, so the page-load vitals wait for it.
      const currentRoute = () =>
        telemetryRoute(router.routerState.snapshot.root.firstChild?.routeConfig?.path ?? '');
      inject(TelemetryService).start(
        currentRoute,
        firstValueFrom(
          router.events.pipe(
            filter((event) => event instanceof NavigationEnd),
            take(1),
            map(currentRoute),
          ),
        ),
      );
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
