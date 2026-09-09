import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
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
import { AppointmentService } from './appointment.service';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
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
    // attaches X-XSRF-TOKEN. Do not block startup indefinitely when offline.
    provideAppInitializer(() =>
      inject(AppointmentService)
        .fetchCsrfToken()
        .pipe(
          timeout(5000),
          catchError(() => of(void 0)),
        ),
    ),
  ],
};
