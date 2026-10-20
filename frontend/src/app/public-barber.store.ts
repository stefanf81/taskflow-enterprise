import { Injectable, computed, inject } from '@angular/core';
import { HttpContext, httpResource } from '@angular/common/http';
import { PublicBarber } from './types/api';
import { BarbersApi } from './core/api/barbers-api';
import { PUBLIC_REQUEST } from './core/http/public-request.token';
import { safeResourceValue } from './core/resource-utils';
import { isServerRender } from './core/platform';
import { publicBarberResponseListSchema } from '@taskflow/schemas';

/**
 * Public barber directory used by the guest booking wizard.
 *
 * The roster is API-driven (`GET /api/v1/barbers`, 5m public cache) — the
 * landing page no longer hardcodes barber names, so adding/removing a barber
 * in the backend is reflected without a frontend deploy.
 */
@Injectable({ providedIn: 'root' })
export class PublicBarberStore {
  private readonly barbersApi = inject(BarbersApi);

  // Build-time prerendering has no backend. Idle on the server renders the same empty list the
  // browser shows while the request is in flight, so hydration starts from identical markup.
  private readonly prerendering = isServerRender();
  private readonly barbersResource = httpResource<PublicBarber[]>(
    () =>
      this.prerendering
        ? undefined
        : {
            url: this.barbersApi.publicListUrl,
            context: new HttpContext().set(PUBLIC_REQUEST, true),
          },
    {
      defaultValue: [],
      parse: (raw) => publicBarberResponseListSchema.parse(raw),
    },
  );

  /** Error-safe: an empty roster (never a throw) while loading or after a failed load. */
  readonly barbers = safeResourceValue<PublicBarber[]>(this.barbersResource, []);
  readonly isLoading = this.barbersResource.isLoading;
  readonly errorMessage = computed(() => {
    const err = this.barbersResource.error();
    return err ? 'Could not load the barber directory.' : null;
  });

  loadBarbers(): void {
    this.barbersResource.reload();
  }
}
