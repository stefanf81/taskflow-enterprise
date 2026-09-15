import { Injectable, signal, computed, inject, effect, DestroyRef } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Barber, BarberTimeOff, BarberTimeOffRequest } from './types/api';
import { BarbersApi } from './core/api/barbers-api';
import { extractApiError } from './core/api/extract-api-error';
import { barberResponseSchema, barberTimeOffResponseSchema } from '@taskflow/schemas';

@Injectable({ providedIn: 'root' })
export class BarberStore {
  private readonly barbersApi = inject(BarbersApi);

  private readonly barbersResource = httpResource<Barber[]>(() => this.barbersApi.adminListUrl, {
    defaultValue: [],
    parse: (raw) => barberResponseSchema.array().parse(raw),
  });

  readonly barbers = this.barbersResource.value;
  readonly selectedBarberId = signal<number | null>(null);

  private readonly timeOffsResource = httpResource<BarberTimeOff[]>(
    () => {
      const id = this.selectedBarberId();
      return id ? this.barbersApi.timeOffUrl(id) : undefined;
    },
    {
      defaultValue: [],
      parse: (raw) => barberTimeOffResponseSchema.array().parse(raw),
    },
  );

  readonly timeOffs = this.timeOffsResource.value;

  readonly isLoading = computed(
    () => this.barbersResource.isLoading() || this.timeOffsResource.isLoading(),
  );

  readonly errorMessage = computed(() => {
    if (this.barbersResource.error()) return 'Could not load barbers.';
    if (this.timeOffsResource.error()) return 'Could not load time off.';
    return null;
  });

  // Action-level error surfaced to the UI when a write (add time off) fails.
  // Separate from the read-only errorMessage so a transient write failure does
  // not mask a load error and vice-versa.
  readonly actionErrorMessage = signal<string | null>(null);
  readonly actionSuccessMessage = signal<string | null>(null);
  readonly isSaving = signal<boolean>(false);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    effect(() => {
      const first = this.barbers()[0];
      if (first && !this.selectedBarberId()) {
        this.selectedBarberId.set(first.id);
      }
    });
  }

  loadBarbers(): void {
    this.barbersResource.reload();
  }

  selectBarber(id: number): void {
    this.selectedBarberId.set(id);
  }

  loadTimeOffs(barberId: number): void {
    this.selectedBarberId.set(barberId);
    this.timeOffsResource.reload();
  }

  addTimeOff(request: BarberTimeOffRequest): void {
    const barberId = this.selectedBarberId();
    if (!barberId) return;

    this.actionErrorMessage.set(null);
    this.isSaving.set(true);
    this.barbersApi
      .addTimeOff(barberId, request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          this.actionErrorMessage.set(null);
          this.actionSuccessMessage.set('Time off added successfully.');
          this.timeOffsResource.reload();
        },
        error: (err) => {
          this.isSaving.set(false);
          this.actionErrorMessage.set(
            this.extractError(err, 'Failed to add time off. Please try again.'),
          );
        },
      });
  }

  private extractError(err: unknown, fallback: string): string {
    return extractApiError(err, fallback);
  }
}
