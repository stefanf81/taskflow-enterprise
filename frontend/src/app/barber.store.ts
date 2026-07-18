import { Service, signal, computed, inject, effect } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { AppointmentService, Barber, BarberTimeOff } from './appointment.service';

@Service()
export class BarberStore {
  private readonly appointmentService = inject(AppointmentService);

  private readonly barbersResource = httpResource<Barber[]>(() => '/api/v1/barbers', {
    defaultValue: [],
  });

  readonly barbers = this.barbersResource.value;
  readonly selectedBarberId = signal<number | null>(null);

  private readonly timeOffsResource = httpResource<BarberTimeOff[]>(
    () => {
      const id = this.selectedBarberId();
      return id ? `/api/v1/barbers/${id}/time-off` : undefined;
    },
    {
      defaultValue: [],
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

  constructor() {
    effect(() => {
      const data = this.barbers();
      if (data.length > 0 && !this.selectedBarberId()) {
        this.selectedBarberId.set(data[0].id);
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

  addTimeOff(request: BarberTimeOff): void {
    const barberId = this.selectedBarberId();
    if (!barberId) return;

    this.actionErrorMessage.set(null);
    this.isSaving.set(true);
    this.appointmentService.addTimeOff(barberId, request).subscribe({
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
    const detail = (err as { error?: { message?: string } })?.error?.message;
    return detail && typeof detail === 'string' ? detail : fallback;
  }
}
