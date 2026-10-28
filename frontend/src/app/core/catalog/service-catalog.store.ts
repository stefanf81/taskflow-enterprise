import { Injectable, computed, inject } from '@angular/core';
import { HttpContext, httpResource } from '@angular/common/http';
import { ServiceItem } from '../../types/api';
import { CatalogApi } from '../api/catalog-api';
import { PUBLIC_REQUEST } from '../http/public-request.token';
import { safeResourceValue } from '../resource-utils';
import { isServerRender } from '../platform';
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
  /**
   * Whether the request has produced a list. False while prerendering (no request is made) and
   * while the first load is in flight, so the placeholder rows that stand in for the menu render
   * identically on the server and in the browser, and hydration still matches. Once this turns
   * true an empty list really means "no services", not "not here yet".
   */
  readonly hasLoaded = computed(() => {
    const status = this.servicesResource.status();
    return status === 'resolved' || status === 'local';
  });
  readonly errorMessage = computed(() => {
    const err = this.servicesResource.error();
    return err ? 'Could not load service catalog.' : null;
  });

  loadServices(): void {
    this.servicesResource.reload();
  }
}
