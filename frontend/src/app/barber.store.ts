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

    this.appointmentService.addTimeOff(barberId, request).subscribe({
      next: () => {
        this.timeOffsResource.reload();
      },
      error: (err) => {
        console.error('Failed to add time off:', err);
      },
    });
  }
}
