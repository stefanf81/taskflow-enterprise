import { Component, computed, inject } from '@angular/core';
import { openingHoursRows } from '@taskflow/domain';
import { ReviewStore } from '../../../core/reviews/review.store';
import { ShopClock } from '../../../core/shop-clock';
import { Icon } from '../../../core/ui/icon';
import { clockIcon } from '../../../core/ui/icons/clock';
import { scissorsIcon } from '../../../core/ui/icons/scissors';
import { sprayCanIcon } from '../../../core/ui/icons/spray-can';
import { starIcon } from '../../../core/ui/icons/star';
import { RetailProducts } from '../retail-products/retail-products';

/**
 * The landing page's shop cards: opening hours, retail products and client ratings (the menu is
 * step 1 of the booking wizard). Prerendered (so first paint is unchanged) but in a deferred, lazily hydrated block of the
 * landing page, which keeps the catalog and review stores, their API clients and their schemas, and
 * this template, out of main.js (the initial bundle has little headroom, see docs/agents/frontend.md).
 */
@Component({
  selector: 'app-shop-details',
  imports: [Icon, RetailProducts],
  template: `
    <section aria-labelledby="shop-details-heading" class="mt-16">
      <h2
        id="shop-details-heading"
        class="text-lg font-black text-zinc-100 uppercase tracking-tight mb-6"
      >
        <app-icon [icon]="icons.scissors" /> Visit the Shop
      </h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        <!-- Operating Hours Panel -->
        <div class="card p-5">
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
        <div class="card p-5">
          <h3 class="text-zinc-100 font-bold text-xs uppercase tracking-wider mb-3">
            <app-icon [icon]="icons.sprayCan" /> Artisanal Products
          </h3>
          <!-- From /api/v1/catalog/products, loaded when the card scrolls into view: the
               placeholder holds the three seeded rows' height (h-16). -->
          @defer (on viewport; prefetch on idle) {
            <app-retail-products />
          } @placeholder {
            <div class="h-16"></div>
          }
        </div>

        <!-- Client ratings from the real reviews (/reviews/public/barber-ratings). They load
             after hydration, so the body keeps its height (min-h-12) from first paint and the
             prerendered page shows the same empty box as the browser while it loads. -->
        <div class="card p-5">
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
      </div>
    </section>
  `,
})
export class ShopDetails {
  protected readonly icons = {
    clock: clockIcon,
    scissors: scissorsIcon,
    sprayCan: sprayCanIcon,
    star: starIcon,
  };
  private readonly shopClock = inject(ShopClock);
  private readonly reviewStore = inject(ReviewStore);

  /**
   * The week's hours from the barbers' schedules (`/public/shop`). The prerendered page shows the
   * server's defaults, which the browser replaces once the real hours have loaded.
   */
  protected readonly openingHours = computed(() => openingHoursRows(this.shopClock.rules()));

  /** The shop's real rating (every barber's reviews), shown instead of a hand-picked quote. */
  protected readonly ratingSummary = this.reviewStore.shopSummary;
  protected readonly ratingsLoaded = this.reviewStore.hasLoaded;
  protected readonly ratingsError = this.reviewStore.errorMessage;
}
