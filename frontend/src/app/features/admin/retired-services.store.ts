import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { serviceItemResponseListSchema } from '@taskflow/schemas';
import { ServiceItem } from '../../types/api';
import { CatalogApi } from '../../core/api/catalog-api';
import { extractApiError } from '../../core/api/extract-api-error';
import { ServiceCatalogStore } from '../../core/catalog/service-catalog.store';
import { refreshResource, safeResourceValue } from '../../core/resource-utils';
import { SessionEvents } from '../../core/session-events';

/**
 * The owner's view of retired services: a service that is deleted while appointments still
 * reference it is retired, not removed. Admin only, so unlike the public menu it is never loaded
 * for guests; the first owner tab that injects this store starts the request.
 */
@Injectable({ providedIn: 'root' })
export class RetiredServicesStore {
  private readonly catalogApi = inject(CatalogApi);
  private readonly catalogStore = inject(ServiceCatalogStore);
  private readonly destroyRef = inject(DestroyRef);

  private readonly refreshTick = signal(0);
  private readonly retiredResource = httpResource<ServiceItem[]>(
    () => {
      // Read so refreshResource() can restart a load that reload() would drop.
      this.refreshTick();
      return this.catalogApi.retiredUrl;
    },
    {
      defaultValue: [],
      parse: (raw) => serviceItemResponseListSchema.parse(raw),
    },
  );

  /** Error-safe: an empty list (never a throw) while loading or after a failed load. */
  readonly services = safeResourceValue<ServiceItem[]>(this.retiredResource, []);
  readonly isLoading = this.retiredResource.isLoading;
  readonly errorMessage = computed(() =>
    this.retiredResource.error() ? 'Could not load retired services.' : null,
  );

  /** The service whose restore request is in flight; one at a time. */
  readonly restoringId = signal<number | null>(null);
  readonly actionErrorMessage = signal<string | null>(null);
  readonly actionSuccessMessage = signal<string | null>(null);

  constructor() {
    // Drop per-session banners when the owner signs out / the session expires.
    inject(SessionEvents)
      .sessionEnded.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.restoringId.set(null);
        this.actionErrorMessage.set(null);
        this.actionSuccessMessage.set(null);
      });
  }

  loadRetired(): void {
    refreshResource(this.retiredResource, this.refreshTick);
  }

  restore(service: ServiceItem): void {
    if (this.restoringId() !== null) return;
    this.actionErrorMessage.set(null);
    this.actionSuccessMessage.set(null);
    this.restoringId.set(service.id);
    this.catalogApi
      .restoreService(service.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.restoringId.set(null);
          this.actionSuccessMessage.set(`${service.name} is bookable again.`);
          // It left this list and joined the public menu.
          this.loadRetired();
          this.catalogStore.loadServices();
        },
        error: (err) => {
          this.restoringId.set(null);
          this.actionErrorMessage.set(
            extractApiError(err, `Could not restore ${service.name}. Please try again.`),
          );
        },
      });
  }
}
