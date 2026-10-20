import { Injectable, computed, inject } from '@angular/core';
import { HttpContext, httpResource } from '@angular/common/http';
import { ServiceItem } from './types/api';
import { CatalogApi } from './core/api/catalog-api';
import { PUBLIC_REQUEST } from './core/http/public-request.token';
import { safeResourceValue } from './core/resource-utils';
import { isServerRender } from './core/platform';
import { serviceItemResponseListSchema } from '@taskflow/schemas';

@Injectable({ providedIn: 'root' })
export class ServiceCatalogStore {
  private readonly catalogApi = inject(CatalogApi);

  // Build-time prerendering has no backend. Idle on the server renders the same empty list the
  // browser shows while the request is in flight, so hydration starts from identical markup.
  private readonly prerendering = isServerRender();
  private readonly servicesResource = httpResource<ServiceItem[]>(
    () =>
      this.prerendering
        ? undefined
        : {
            url: this.catalogApi.servicesUrl,
            context: new HttpContext().set(PUBLIC_REQUEST, true),
          },
    {
      defaultValue: [],
      // Runtime contract check: a drifted backend response becomes a resource
      // error (visible as the store's error message) instead of undefined UI.
      parse: (raw) => serviceItemResponseListSchema.parse(raw),
    },
  );

  /** Error-safe: an empty list (never a throw) while loading or after a failed load. */
  readonly services = safeResourceValue<ServiceItem[]>(this.servicesResource, []);
  readonly isLoading = this.servicesResource.isLoading;
  readonly errorMessage = computed(() => {
    const err = this.servicesResource.error();
    return err ? 'Could not load service catalog.' : null;
  });

  loadServices(): void {
    this.servicesResource.reload();
  }
}
