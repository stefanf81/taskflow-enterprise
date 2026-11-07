import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { serviceItemSchema } from '@taskflow/schemas';
import { CatalogApi } from '../../core/api/catalog-api';
import { extractApiError } from '../../core/api/extract-api-error';
import { ServiceCatalogStore } from '../../core/catalog/service-catalog.store';
import { ServiceItem } from '../../types/api';
import { RetiredServicesStore } from './retired-services.store';

interface ServiceDraft {
  name: string;
  price: string;
  durationMinutes: string;
  category: string;
  description: string;
}

const emptyDraft = (): ServiceDraft => ({
  name: '',
  price: '',
  durationMinutes: '',
  category: '',
  description: '',
});

/** Owner dashboard · service catalog tab: the menu, and the retired services that can be restored. */
@Component({
  selector: 'app-admin-services-tab',
  imports: [CommonModule],
  templateUrl: './admin-services-tab.html',
})
export class AdminServicesTab {
  private readonly catalogApi = inject(CatalogApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly catalogStore = inject(ServiceCatalogStore);

  protected readonly retiredStore = inject(RetiredServicesStore);

  protected readonly services = this.catalogStore.services;
  protected readonly isLoading = this.catalogStore.isLoading;
  protected readonly errorMessage = this.catalogStore.errorMessage;
  protected readonly editorOpen = signal(false);
  protected readonly editingId = signal<number | null>(null);
  protected readonly draft = signal<ServiceDraft>(emptyDraft());
  protected readonly retiring = signal<ServiceItem | null>(null);
  protected readonly isSaving = signal(false);
  protected readonly pending = computed(
    () => this.isSaving() || this.retiredStore.restoringId() !== null,
  );
  protected readonly actionError = signal<string | null>(null);
  protected readonly actionSuccess = signal<string | null>(null);

  protected openEditor(service?: ServiceItem): void {
    if (this.pending()) return;
    this.editingId.set(service?.id ?? null);
    this.draft.set(
      service
        ? {
            name: service.name,
            price: String(service.price),
            durationMinutes: String(service.durationMinutes),
            category: service.category,
            description: service.description,
          }
        : emptyDraft(),
    );
    this.actionError.set(null);
    this.retiring.set(null);
    this.editorOpen.set(true);
  }

  protected updateDraft(field: keyof ServiceDraft, value: string): void {
    this.draft.update((draft) => ({ ...draft, [field]: value }));
  }

  protected save(event: Event): void {
    event.preventDefault();
    if (this.pending()) return;
    const draft = this.draft();
    const parsed = serviceItemSchema.safeParse({
      ...draft,
      price: Number(draft.price),
      durationMinutes: Number(draft.durationMinutes),
    });
    if (!parsed.success) {
      this.actionError.set(parsed.error.issues[0]?.message ?? 'Please check the service details.');
      return;
    }
    this.isSaving.set(true);
    this.actionError.set(null);
    this.actionSuccess.set(null);
    const id = this.editingId();
    const request =
      id === null
        ? this.catalogApi.createService(parsed.data)
        : this.catalogApi.updateService(id, parsed.data);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.isSaving.set(false);
        this.editorOpen.set(false);
        this.actionSuccess.set(`${saved.name} ${id === null ? 'created' : 'updated'}.`);
        this.catalogStore.upsertService(saved);
        this.retiredStore.loadRetired();
      },
      error: (error) => {
        this.isSaving.set(false);
        this.actionError.set(
          extractApiError(error, 'Could not save the service. Please try again.'),
        );
      },
    });
  }

  protected confirmRetire(): void {
    const service = this.retiring();
    if (!service || this.pending()) return;
    this.isSaving.set(true);
    this.actionError.set(null);
    this.actionSuccess.set(null);
    this.catalogApi
      .retireService(service.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          this.retiring.set(null);
          this.actionSuccess.set(`${service.name} removed from the booking menu.`);
          this.catalogStore.removeService(service.id);
          this.retiredStore.loadRetired();
        },
        error: (error) => {
          this.isSaving.set(false);
          this.actionError.set(
            extractApiError(error, `Could not retire ${service.name}. Please try again.`),
          );
        },
      });
  }
}
