import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ServiceCatalogStore } from '../../core/catalog/service-catalog.store';
import { RetiredServicesStore } from './retired-services.store';

/** Owner dashboard · service catalog tab: the menu, and the retired services that can be restored. */
@Component({
  selector: 'app-admin-services-tab',
  imports: [CommonModule],
  templateUrl: './admin-services-tab.html',
})
export class AdminServicesTab {
  protected readonly catalogStore = inject(ServiceCatalogStore);

  protected readonly retiredStore = inject(RetiredServicesStore);

  protected readonly services = this.catalogStore.services;
  protected readonly isLoading = this.catalogStore.isLoading;
  protected readonly errorMessage = this.catalogStore.errorMessage;
}
