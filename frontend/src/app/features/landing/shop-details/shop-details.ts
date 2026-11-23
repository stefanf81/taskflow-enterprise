import { Component, computed, inject } from '@angular/core';
import { openingHoursRows } from '@taskflow/domain';
import { ServiceCatalogStore } from '../../../core/catalog/service-catalog.store';
import { formatUsd } from '../../../core/format';
import { ReviewStore } from '../../../core/reviews/review.store';
import { ShopClock } from '../../../core/shop-clock';
import { Button } from '../../../core/ui/button';
import { Icon } from '../../../core/ui/icon';
import { clockIcon } from '../../../core/ui/icons/clock';
import { hourglassIcon } from '../../../core/ui/icons/hourglass';
import { scissorsIcon } from '../../../core/ui/icons/scissors';
import { sprayCanIcon } from '../../../core/ui/icons/spray-can';
import { starIcon } from '../../../core/ui/icons/star';
import { timerIcon } from '../../../core/ui/icons/timer';
import { RetailProducts } from '../retail-products/retail-products';

/**
 * The landing page's shop cards: the grooming menu, opening hours, retail products and client
 * ratings. Prerendered (so first paint is unchanged) but in a deferred, lazily hydrated block of the
 * landing page, which keeps the catalog and review stores, their API clients and their schemas, and
 * this template, out of main.js (the initial bundle has little headroom, see docs/agents/frontend.md).
 */
@Component({
  selector: 'app-shop-details',
  imports: [Button, Icon, RetailProducts],
  template: `
    <section class="card p-8">
      <h2
        class="text-lg font-black text-zinc-100 uppercase tracking-tight mb-6 pb-4 border-b border-white/5"
      >
        <app-icon [icon]="icons.scissors" /> Grooming Menu
      </h2>

      @if (servicesError()) {
        <div role="alert" class="text-center text-xs text-rose-400 mb-6">
          <p>{{ servicesError() }}</p>
          <button type="button" appButton="secondary" class="mt-3" (click)="retryServices()">
            Retry
          </button>
        </div>
      }
      <div class="space-y-6">
        @for (service of services(); track service.name) {
          <div class="border-b border-white/5 pb-4 last:border-none last:pb-0">
            <div class="flex justify-between items-center font-bold text-sm mb-1">
              <span class="text-zinc-100">{{ service.name }}</span>
              <span class="text-accent">{{ formatUsd(service.price) }}</span>
            </div>
            <p class="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
              <app-icon [icon]="icons.timer" /> Duration: {{ service.durationMinutes }} mins
            </p>
            <p class="text-xs text-zinc-400 font-light leading-relaxed">
              {{ service.description }}
            </p>
          </div>
        } @empty {
          <!-- The catalog is fetched after hydration, so the prerendered page (and the
           in-flight state that follows it) would otherwise show an empty panel and
           push everything below it down once the rows arrive. These placeholders
           reserve that height. Rendered identically on the server and in the browser,
           so hydration still matches. -->
          @if (servicesError()) {
            <!-- the error and its retry button are rendered above the list -->
          } @else if (servicesLoaded()) {
            <p class="text-xs text-zinc-400 font-light">No treatments are on the menu right now.</p>
          } @else {
            @for (row of skeletonRows; track row) {
              <div
                aria-hidden="true"
                class="border-b border-white/5 pb-4 last:border-none last:pb-0 animate-pulse"
              >
                <div class="flex justify-between items-center mb-2">
                  <div class="h-4 w-40 rounded bg-white/10"></div>
                  <div class="h-4 w-12 rounded bg-white/10"></div>
                </div>
                <div class="h-3 w-28 rounded bg-white/5 mb-3"></div>
                <div class="h-3 w-full rounded bg-white/5 mb-1.5"></div>
                <div class="h-3 w-3/4 rounded bg-white/5"></div>
              </div>
            }
          }
        }
      </div>

      <!-- Operating Hours Panel -->
      <div class="mt-8 rounded-2xl border border-white/10 bg-zinc-900/50 p-5">
        <h3 class="text-zinc-100 font-bold text-xs uppercase tracking-wider mb-3">
          <app-icon [icon]="icons.clock" /> Operating Hours
        </h3>
        <div class="space-y-2 text-xs text-zinc-400 font-light">
          @for (row of openingHours(); track row.days) {
            @if (row.hours) {
              <p class="flex justify-between">
                <span>{{ row.days }}</span>
                <span class="font-medium text-zinc-300">{{ row.hours }}</span>
              </p>
            } @else {
              <p class="flex justify-between text-rose-500 font-semibold">
                <span>{{ row.days }}</span> <span>CLOSED</span>
              </p>
            }
          }
        </div>
      </div>

      <!-- Grooming Clays -->
      <div
        class="mt-6 rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-900 to-accent-soft/10 p-5"
      >
        <h3 class="text-zinc-100 font-bold text-xs uppercase tracking-wider mb-3">
          <app-icon [icon]="icons.sprayCan" /> Artisanal Products
        </h3>
        <!-- From /api/v1/catalog/products, loaded when the card scrolls into view (it is
         below the fold): the placeholder holds the three seeded rows' height (h-16). -->
        @defer (on viewport; prefetch on idle) {
          <app-retail-products />
        } @placeholder {
          <div class="h-16"></div>
        }
      </div>

      <!-- Client ratings from the real reviews (/reviews/public/barber-ratings). They load
       after hydration, so the body keeps its height (min-h-12) from first paint and the
       prerendered page shows the same empty box as the browser while it loads. -->
      <div class="mt-6 rounded-xl border border-white/5 bg-zinc-900/5 p-5">
        <h3 class="text-zinc-100 font-bold text-xs uppercase tracking-wider mb-3">
          <app-icon [icon]="icons.star" /> Client Ratings
        </h3>
        <div class="min-h-12">
          @if (ratingSummary(); as summary) {
            <p class="flex items-baseline gap-2">
              <span class="text-2xl font-black text-accent leading-none">{{
                summary.averageRating.toFixed(1)
              }}</span>
              <span class="sr-only"> out of 5</span>
              <span aria-hidden="true" class="text-accent text-sm leading-none">★</span>
              <span class="text-xs text-zinc-400"
                >from {{ summary.reviewCount }}
                {{ summary.reviewCount === 1 ? 'review' : 'reviews' }}</span
              >
            </p>
            <p class="text-xs text-zinc-400 mt-2">
              Top rated:
              <span class="font-medium text-zinc-200">{{ summary.topBarber.barberName }}</span>
              · {{ summary.topBarber.averageRating.toFixed(1) }}
              <span aria-hidden="true">★</span>
            </p>
          } @else if (ratingsError()) {
            <p class="text-xs text-zinc-400 font-light leading-relaxed">
              Ratings are unavailable right now.
            </p>
          } @else if (ratingsLoaded()) {
            <p class="text-xs text-zinc-400 font-light leading-relaxed">
              No reviews yet. After your visit you can rate your barber below.
            </p>
          }
        </div>
      </div>
    </section>
  `,
})
export class ShopDetails {
  protected readonly icons = {
    clock: clockIcon,
    hourglass: hourglassIcon,
    scissors: scissorsIcon,
    sprayCan: sprayCanIcon,
    star: starIcon,
    timer: timerIcon,
  };
  private readonly catalogStore = inject(ServiceCatalogStore);
  private readonly shopClock = inject(ShopClock);
  private readonly reviewStore = inject(ReviewStore);

  /**
   * The week's hours from the barbers' schedules (`/public/shop`). The prerendered page shows the
   * server's defaults, which the browser replaces once the real hours have loaded.
   */
  protected readonly openingHours = computed(() => openingHoursRows(this.shopClock.rules()));

  protected readonly formatUsd = formatUsd;
  protected readonly services = this.catalogStore.services;
  protected readonly servicesError = this.catalogStore.errorMessage;
  protected readonly servicesLoaded = this.catalogStore.hasLoaded;
  /** Placeholder rows shown until the catalog arrives; the seeded catalog has five services. */
  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  /** The shop's real rating (every barber's reviews), shown instead of a hand-picked quote. */
  protected readonly ratingSummary = this.reviewStore.shopSummary;
  protected readonly ratingsLoaded = this.reviewStore.hasLoaded;
  protected readonly ratingsError = this.reviewStore.errorMessage;

  protected retryServices(): void {
    this.catalogStore.loadServices();
  }
}
