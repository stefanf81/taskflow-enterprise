import { Injectable, computed, inject } from '@angular/core';
import { HttpContext, httpResource } from '@angular/common/http';
import { ServiceItem } from './types/api';
import { CatalogApi } from './core/api/catalog-api';
import { PUBLIC_REQUEST } from './core/http/public-request.token';
import { serviceItemResponseSchema } from '@taskflow/schemas';

@Injectable({ providedIn: 'root' })
export class ServiceCatalogStore {
  private readonly catalogApi = inject(CatalogApi);

  private readonly servicesResource = httpResource<ServiceItem[]>(
    () => ({
      url: this.catalogApi.servicesUrl,
      context: new HttpContext().set(PUBLIC_REQUEST, true),
    }),
    {
      defaultValue: [],
      // Runtime contract check: a drifted backend response becomes a resource
      // error (visible as the store's error message) instead of undefined UI.
      parse: (raw) => serviceItemResponseSchema.array().parse(raw),
    },
  );

  readonly services = this.servicesResource.value;
  readonly isLoading = this.servicesResource.isLoading;
  readonly errorMessage = computed(() => {
    const err = this.servicesResource.error();
    return err ? 'Could not load service catalog.' : null;
  });

  loadServices(): void {
    this.servicesResource.reload();
  }
}
