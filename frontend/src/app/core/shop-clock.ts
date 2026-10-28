import { Injectable, computed, inject } from '@angular/core';
import { HttpContext, httpResource } from '@angular/common/http';
import { AppointmentsApi } from './api/appointments-api';
import { PUBLIC_REQUEST } from './http/public-request.token';
import { isServerRender } from './platform';
import { safeResourceValue } from './resource-utils';
import { shopWallClock } from './time-utils';
import { shopInfoResponseSchema } from '@taskflow/schemas';

/**
 * The shop's wall clock.
 *
 * The backend judges every booking (past, too far ahead, reminders) in the shop's time zone
 * (`app.shop.time-zone`), not the visitor's. This reads that zone once from
 * `GET /api/v1/appointments/public/shop` and hands out `now()` as a Date whose local components
 * are the shop's, so the wizard greys out the same slots the server would refuse. Until the zone
 * is known (or when it cannot be loaded) it is the visitor's own clock, as before.
 */
@Injectable({ providedIn: 'root' })
export class ShopClock {
  private readonly appointmentsApi = inject(AppointmentsApi);

  // Prerendering has no backend; the browser fetches it after hydration.
  private readonly prerendering = isServerRender();
  private readonly resource = httpResource<{ timeZone: string } | null>(
    () =>
      this.prerendering
        ? undefined
        : {
            url: this.appointmentsApi.shopInfoUrl,
            context: new HttpContext().set(PUBLIC_REQUEST, true),
          },
    {
      defaultValue: null,
      parse: (raw) => shopInfoResponseSchema.parse(raw),
    },
  );
  private readonly info = safeResourceValue<{ timeZone: string } | null>(this.resource, null);

  /** IANA zone of the shop, or null while unknown. */
  readonly timeZone = computed(() => this.info()?.timeZone ?? null);

  /** The shop's current wall-clock time (see {@link shopWallClock}). */
  now(): Date {
    return shopWallClock(this.timeZone());
  }
}
