import { Injectable, signal, computed, inject, effect, DestroyRef } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Barber, BarberTimeOff, BarberTimeOffRequest } from './types/api';
import { BarbersApi } from './core/api/barbers-api';
import { extractApiError } from './core/api/extract-api-error';
import { refreshResource, safeResourceValue } from './core/resource-utils';
import { SessionEvents } from './core/session-events';
import { barberResponseListSchema, barberTimeOffResponseListSchema } from '@taskflow/schemas';

@Injectable({ providedIn: 'root' })
export class BarberStore {
  private readonly barbersApi = inject(BarbersApi);

  private readonly barbersResource = httpResource<Barber[]>(() => this.barbersApi.adminListUrl, {
    defaultValue: [],
    parse: (raw) => barberResponseListSchema.parse(raw),
  });

  /** Error-safe: an empty roster (never a throw) while loading or after a failed load. */
  readonly barbers = safeResourceValue<Barber[]>(this.barbersResource, []);
  readonly selectedBarberId = signal<number | null>(null);

  private readonly timeOffRefreshTick = signal(0);
  private readonly timeOffsResource = httpResource<BarberTimeOff[]>(
    () => {
      const id = this.selectedBarberId();
      // Read so refreshResource() can restart a load that reload() would drop.
      this.timeOffRefreshTick();
      return id ? this.barbersApi.timeOffUrl(id) : undefined;
    },
    {
      defaultValue: [],
      parse: (raw) => barberTimeOffResponseListSchema.parse(raw),
    },
  );

  readonly timeOffs = safeResourceValue<BarberTimeOff[]>(this.timeOffsResource, []);

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
    // Drop per-session banners when the admin signs out / the session expires.
    inject(SessionEvents)
      .sessionEnded.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.actionErrorMessage.set(null);
        this.actionSuccessMessage.set(null);
        this.isSaving.set(false);
      });
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
    refreshResource(this.timeOffsResource, this.timeOffRefreshTick);
  }

  /**
   * Adds a time-off entry. Resolves `true` on success and `false` on failure so
   * the caller can reset its form ONLY when the server accepted the entry (the
   * input is kept on error so the owner can fix it and retry).
   */
  addTimeOff(request: BarberTimeOffRequest): Promise<boolean> {
    const barberId = this.selectedBarberId();
    if (!barberId || this.isSaving()) return Promise.resolve(false);

    this.actionErrorMessage.set(null);
    this.isSaving.set(true);
    return new Promise<boolean>((resolve) => {
      this.barbersApi
        .addTimeOff(barberId, request)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.isSaving.set(false);
            this.actionErrorMessage.set(null);
            this.actionSuccessMessage.set('Time off added successfully.');
            refreshResource(this.timeOffsResource, this.timeOffRefreshTick);
            resolve(true);
          },
          error: (err) => {
            this.isSaving.set(false);
            this.actionErrorMessage.set(
              this.extractError(err, 'Failed to add time off. Please try again.'),
            );
            resolve(false);
          },
        });
    });
  }

  private extractError(err: unknown, fallback: string): string {
    return extractApiError(err, fallback);
  }
}
