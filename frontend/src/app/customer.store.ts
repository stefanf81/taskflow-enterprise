import { Service, signal, computed, inject } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { AppointmentService, AppointmentItem } from './appointment.service';

@Service()
export class CustomerStore {
  private readonly appointmentService = inject(AppointmentService);
  readonly currentPage = signal<number>(0);

  private readonly appointmentsResource = httpResource<{ content: AppointmentItem[]; totalPages: number }>(
    () => `/api/v1/customer/appointments?page=${this.currentPage()}&size=10`,
    {
      defaultValue: { content: [], totalPages: 1 }
    }
  );

  readonly appointments = computed(() => this.appointmentsResource.value()?.content ?? []);

  loadAppointments(): void {
    this.appointmentsResource.reload();
  }

  cancelAppointment(id: number): void {
    if (!confirm('Are you sure you want to cancel this appointment?')) return;

    this.appointmentService.cancelCustomerAppointment(id).subscribe({
      next: () => {
        this.loadAppointments();
      },
      error: (err) => {
        console.error('Failed to cancel appointment:', err);
      },
    });
  }
}
