import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpContext, httpResource } from '@angular/common/http';
import { RetailProductResponse, retailProductResponseListSchema } from '@taskflow/schemas';
import { RetailProductsApi } from '../api/retail-products-api';
import { PUBLIC_REQUEST } from '../http/public-request.token';
import { refreshResource, safeResourceValue } from '../resource-utils';
import { isServerRender } from '../platform';

/**
 * The shop's retail products (display only), shared by the landing page's products card and the
 * owner's catalog tab. Not injected by anything in main.js: the landing card loads in a deferred
 * block, so neither this store nor its request reaches the initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class RetailProductStore {
  private readonly api = inject(RetailProductsApi);

  // Build-time prerendering has no backend (the landing card is not prerendered anyway).
  private readonly prerendering = isServerRender();
  private readonly refreshTick = signal(0);
  private readonly productsResource = httpResource<RetailProductResponse[]>(
    () => {
      this.refreshTick();
      return this.prerendering
        ? undefined
        : { url: this.api.productsUrl, context: new HttpContext().set(PUBLIC_REQUEST, true) };
    },
    { defaultValue: [], parse: (raw) => retailProductResponseListSchema.parse(raw) },
  );

  /** Error-safe: an empty list (never a throw) while loading or after a failed load. */
  readonly products = safeResourceValue<RetailProductResponse[]>(this.productsResource, []);
  readonly isLoading = this.productsResource.isLoading;
  /** Whether the request has produced a list; once true, an empty list really means none. */
  readonly hasLoaded = computed(() => {
    const status = this.productsResource.status();
    return status === 'resolved' || status === 'local';
  });
  readonly errorMessage = computed(() =>
    this.productsResource.error() ? 'Could not load the products.' : null,
  );

  reload(): void {
    refreshResource(this.productsResource, this.refreshTick);
  }
}
