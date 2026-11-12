import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { HttpContext, httpResource } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  DEFAULT_SHOP_RULES,
  type ShopRules,
  type WallClock,
  shopWallClock,
} from '@taskflow/domain';
import { shopInfoResponseSchema, type ShopInfoResponse } from '@taskflow/schemas';
import { AppointmentsApi } from './api/appointments-api';
import { PUBLIC_REQUEST } from './http/public-request.token';
import { isServerRender } from './platform';
import { ReferenceDataEvents } from './reference-data-events';
import { refreshResource, safeResourceValue } from './resource-utils';

/**
 * The shop's clock and booking rules.
 *
 * The backend judges every booking (past, too far ahead, open that day) in the shop's time zone
 * (`app.shop.time-zone`) and by its own rules, not the visitor's. This reads them once from
 * `GET /api/v1/appointments/public/shop`: `now()` is a Date whose local components are the shop's,
 * and `rules()` the booking window and opening hours, so the wizard greys out the same days and
 * slots the server would refuse. Until they are known (or when they cannot be loaded) it is the
 * visitor's own clock and the server's default rules; the server stays authoritative.
 */
@Injectable({ providedIn: 'root' })
export class ShopClock {
  private readonly appointmentsApi = inject(AppointmentsApi);

  // Prerendering has no backend; the browser fetches it after hydration.
  private readonly prerendering = isServerRender();
  private readonly refreshTick = signal(0);
  private readonly clockTick = signal(0);
  private readonly resource = httpResource<ShopInfoResponse | null>(
    () => {
      this.refreshTick();
      return this.prerendering
        ? undefined
        : {
            url: this.appointmentsApi.shopInfoUrl,
            context: new HttpContext().set(PUBLIC_REQUEST, true),
          };
    },
    {
      defaultValue: null,
      parse: (raw) => shopInfoResponseSchema.parse(raw),
    },
  );
  private readonly info = safeResourceValue<ShopInfoResponse | null>(this.resource, null);

  constructor() {
    // Opening hours derive from the barbers' schedules, which an admin may just have changed.
    inject(ReferenceDataEvents)
      .rosterChanged.pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => this.reload());
  }

  /** Refetches the shop facts (the response is revalidated with its ETag). */
  reload(): void {
    refreshResource(this.resource, this.refreshTick);
  }

  /** IANA zone of the shop, or null while unknown. */
  readonly timeZone = computed(() => this.info()?.timeZone ?? null);

  /** Booking window and opening hours: the server's, or its defaults until they are known. */
  readonly rules = computed<ShopRules>(() => {
    const info = this.info();
    return info
      ? { maxAdvanceDays: info.maxAdvanceDays, openingHours: info.openingHours }
      : DEFAULT_SHOP_RULES;
  });

  /** Whether the rules came from the server (false while loading, after a failure, prerendering). */
  readonly loaded = computed(() => this.info() !== null);

  /**
   * The shop's current wall-clock time (see {@link shopWallClock}). Reactive to {@link watch} and
   * {@link tick} so `computed` consumers (`openNow`, `ReschedulePicker`) advance while open.
   */
  now(): WallClock {
    this.clockTick();
    return shopWallClock(this.timeZone());
  }

  /** Forces reactive consumers of {@link now} to re-read the wall clock immediately. */
  tick(): void {
    this.clockTick.update((n) => n + 1);
  }

  /**
   * Keeps {@link now} reactive while `owner` is mounted: ticks every `intervalMs` and whenever a
   * hidden tab becomes visible again. No-op during prerendering, and torn down with `owner` so no
   * global interval outlives the view that needs it.
   */
  watch(owner: DestroyRef, intervalMs = 60_000): void {
    if (this.prerendering || typeof document === 'undefined') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') this.tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => this.tick(), intervalMs);
    owner.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    });
  }
}
