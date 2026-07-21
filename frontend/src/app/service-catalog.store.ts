import { Injectable, computed } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { ServiceItem } from './appointment.service';

@Injectable({ providedIn: 'root' })
export class ServiceCatalogStore {
  private readonly servicesResource = httpResource<ServiceItem[]>(() => '/api/v1/catalog', {
    defaultValue: [],
  });

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
