import { Service, signal, computed, inject } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { AppointmentService, AppointmentItem } from './appointment.service';

@Service()
export class CustomerStore {
  private readonly appointmentService = inject(AppointmentService);
  readonly currentPage = signal<number>(0);

  private readonly appointmentsResource = httpResource<{
    content: AppointmentItem[];
    totalPages: number;
  }>(() => `/api/v1/customer/appointments?page=${this.currentPage()}&size=10`, {
    defaultValue: { content: [], totalPages: 1 },
  });

  readonly appointments = computed(() => this.appointmentsResource.value()?.content ?? []);

  // Action-level cancel error surfaced to the UI (e.g. wrong email, already
  // cancelled). Separate from the read-only load errors above.
  readonly cancelErrorMessage = signal<string | null>(null);
  readonly isCancelling = signal<boolean>(false);

  loadAppointments(): void {
    this.appointmentsResource.reload();
  }

  cancelAppointment(id: number): void {
    if (!confirm('Are you sure you want to cancel this appointment?')) return;

    this.cancelErrorMessage.set(null);
    this.isCancelling.set(true);
    this.appointmentService.cancelCustomerAppointment(id).subscribe({
      next: () => {
        this.isCancelling.set(false);
        this.cancelErrorMessage.set(null);
        this.loadAppointments();
      },
      error: (err) => {
        this.isCancelling.set(false);
        const detail = (err as { error?: { message?: string } })?.error?.message;
        this.cancelErrorMessage.set(
          detail && typeof detail === 'string'
            ? detail
            : 'Failed to cancel appointment. Please try again.',
        );
      },
    });
  }
}
