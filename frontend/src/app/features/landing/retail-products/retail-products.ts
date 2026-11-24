import { Component, inject } from '@angular/core';
import { RetailProductStore } from '../../../core/catalog/retail-product.store';
import { formatUsd } from '../../../core/format';

/**
 * The rows of the landing page's "Artisanal Products" card, from `/api/v1/catalog/products`.
 *
 * Rendered in a `@defer (on viewport)` block (the card is below the fold), so the store and its
 * request stay out of main.js. The placeholder there and the loading rows here hold the height of
 * the three seeded products, so the card does not jump when they arrive.
 */
@Component({
  selector: 'app-retail-products',
  template: `
    @if (store.errorMessage(); as message) {
      <p role="alert" class="text-xs text-zinc-400 font-light h-16">
        {{ message }}
        <button type="button" class="text-accent font-bold ml-1" (click)="store.reload()">
          Retry
        </button>
      </p>
    } @else if (!store.hasLoaded()) {
      <div aria-hidden="true" class="space-y-2 animate-pulse">
        @for (row of skeletonRows; track row) {
          <div class="flex justify-between h-4">
            <div class="h-3 w-40 rounded bg-white/10"></div>
            <div class="h-3 w-10 rounded bg-white/10"></div>
          </div>
        }
      </div>
    } @else if (store.products().length === 0) {
      <p class="text-xs text-zinc-400 font-light">Ask in the shop about today's products.</p>
    } @else {
      <ul class="space-y-2 text-xs text-zinc-400 font-light">
        @for (product of store.products(); track product.id) {
          <li class="flex justify-between gap-3">
            <span
              >{{ product.name }}{{ product.sizeLabel ? ' (' + product.sizeLabel + ')' : '' }}</span
            >
            <span class="text-accent font-bold">{{ formatUsd(product.price) }}</span>
          </li>
        }
      </ul>
    }
  `,
})
export class RetailProducts {
  protected readonly store = inject(RetailProductStore);
  protected readonly formatUsd = formatUsd;
  /** The three seeded products (V44). */
  protected readonly skeletonRows = [0, 1, 2];
}
