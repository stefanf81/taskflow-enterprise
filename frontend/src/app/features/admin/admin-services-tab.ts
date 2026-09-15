import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ServiceCatalogStore } from '../../service-catalog.store';

/** Owner dashboard · read-only service catalog tab. */
@Component({
  selector: 'app-admin-services-tab',
  imports: [CommonModule],
  templateUrl: './admin-services-tab.html',
})
export class AdminServicesTab {
  readonly catalogStore = inject(ServiceCatalogStore);

  readonly services = this.catalogStore.services;
  readonly isLoading = this.catalogStore.isLoading;
  readonly errorMessage = this.catalogStore.errorMessage;
}
