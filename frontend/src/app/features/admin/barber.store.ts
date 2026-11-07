import { Injectable, signal, computed, inject, effect, DestroyRef } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Barber,
  BarberRequest,
  BarberScheduleResponse,
  BarberTimeOff,
  BarberTimeOffRequest,
  ScheduleChangeRequest,
  SchedulePreviewResponse,
} from '../../types/api';
import { BarbersApi } from '../../core/api/barbers-api';
import { extractApiError } from '../../core/api/extract-api-error';
import { refreshResource, safeResourceValue } from '../../core/resource-utils';
import { SessionEvents } from '../../core/session-events';
import { ReferenceDataEvents } from '../../core/reference-data-events';
import {
  barberResponseListSchema,
  barberScheduleResponseSchema,
  barberTimeOffResponseListSchema,
} from '@taskflow/schemas';

@Injectable({ providedIn: 'root' })
export class BarberStore {
  private readonly barbersApi = inject(BarbersApi);
  private readonly referenceData = inject(ReferenceDataEvents);

  private readonly barbersRefreshTick = signal(0);
  private readonly barbersResource = httpResource<Barber[]>(
    () => {
      this.barbersRefreshTick();
      return this.barbersApi.adminListUrl;
    },
    {
      defaultValue: [],
      parse: (raw) => barberResponseListSchema.parse(raw),
    },
  );

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

  private readonly scheduleRefreshTick = signal(0);
  private readonly scheduleResource = httpResource<BarberScheduleResponse | null>(
    () => {
      const id = this.selectedBarberId();
      this.scheduleRefreshTick();
      return id ? this.barbersApi.scheduleUrl(id) : undefined;
    },
    {
      defaultValue: null,
      parse: (raw) => barberScheduleResponseSchema.parse(raw),
    },
  );

  /** The selected barber's weekly hours and their revision (null while loading or failed). */
  readonly schedule = safeResourceValue<BarberScheduleResponse | null>(this.scheduleResource, null);
  readonly scheduleLoading = this.scheduleResource.isLoading;
  readonly scheduleError = computed(() =>
    this.scheduleResource.error() ? 'Could not load the weekly schedule.' : null,
  );

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
    refreshResource(this.barbersResource, this.barbersRefreshTick);
  }

  selectBarber(id: number): void {
    this.selectedBarberId.set(id);
  }

  loadTimeOffs(barberId: number): void {
    this.selectedBarberId.set(barberId);
    refreshResource(this.timeOffsResource, this.timeOffRefreshTick);
  }

  loadSchedule(): void {
    refreshResource(this.scheduleResource, this.scheduleRefreshTick);
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

  createBarber(request: BarberRequest): Promise<Barber | null> {
    if (this.isSaving()) return Promise.resolve(null);
    this.actionErrorMessage.set(null);
    this.isSaving.set(true);
    return new Promise((resolve) => {
      this.barbersApi
        .createBarber(request)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (created) => {
            this.isSaving.set(false);
            this.actionSuccessMessage.set(`Barber ${created.name} added.`);
            this.loadBarbers();
            this.selectedBarberId.set(created.id);
            // The booking flow's barber list and the shop's hours change with the roster.
            this.referenceData.notifyRosterChanged();
            resolve(created);
          },
          error: (err) => {
            this.isSaving.set(false);
            this.actionErrorMessage.set(
              this.extractError(err, 'Failed to create barber. Please try again.'),
            );
            resolve(null);
          },
        });
    });
  }

  /**
   * Counts the upcoming bookings a schedule change would cancel. A 409 means the schedule
   * changed meanwhile: it is reloaded, so the editor starts again from the current hours.
   */
  previewSchedule(
    barberId: number,
    request: ScheduleChangeRequest,
  ): Promise<SchedulePreviewResponse | null> {
    if (this.isSaving()) return Promise.resolve(null);
    this.actionErrorMessage.set(null);
    this.isSaving.set(true);
    return new Promise((resolve) => {
      this.barbersApi
        .previewSchedule(barberId, request)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.isSaving.set(false);
            resolve(res);
          },
          error: (err) => {
            this.isSaving.set(false);
            this.reportScheduleError(err, 'Failed to preview the schedule change.');
            resolve(null);
          },
        });
    });
  }

  /**
   * Saves a previewed schedule. The server refuses (409) when the schedule or the affected
   * bookings changed since the preview; the schedule is then reloaded for a fresh preview.
   */
  updateSchedule(
    barberId: number,
    request: ScheduleChangeRequest,
  ): Promise<BarberScheduleResponse | null> {
    if (this.isSaving()) return Promise.resolve(null);
    this.actionErrorMessage.set(null);
    this.isSaving.set(true);
    return new Promise((resolve) => {
      this.barbersApi
        .updateSchedule(barberId, request)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.isSaving.set(false);
            this.actionSuccessMessage.set('Weekly schedule updated.');
            if (this.selectedBarberId() === barberId) this.scheduleResource.set(res);
            // The shop's opening hours derive from the schedules.
            this.referenceData.notifyRosterChanged();
            resolve(res);
          },
          error: (err) => {
            this.isSaving.set(false);
            this.reportScheduleError(err, 'Failed to update the weekly schedule.');
            resolve(null);
          },
        });
    });
  }

  private reportScheduleError(err: unknown, fallback: string): void {
    this.actionErrorMessage.set(this.extractError(err, fallback));
    if ((err as { status?: number } | null)?.status === 409) this.loadSchedule();
  }

  private extractError(err: unknown, fallback: string): string {
    return extractApiError(err, fallback);
  }
}
