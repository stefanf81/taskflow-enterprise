import { Injectable, signal, computed, inject, DestroyRef } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthState } from './auth.state';
import { AppointmentPage } from './types/api';
import { AppointmentsApi } from './core/api/appointments-api';
import { extractApiError } from './core/api/extract-api-error';
import { pagedAppointmentResponseSchema } from '@taskflow/schemas';

@Injectable({ providedIn: 'root' })
export class CustomerStore {
  private readonly appointmentsApi = inject(AppointmentsApi);
  private readonly authState = inject(AuthState);
  readonly currentPage = signal<number>(0);

  // Gated on auth: httpResource fires eagerly on creation, so without this
  // guard every guest visit would fire a 401 against a protected endpoint at
  // boot (and churn the auth:unauthorized handler). The request starts
  // reactively once AuthState flips to logged-in.
  private readonly appointmentsResource = httpResource<AppointmentPage>(
    () => {
      if (!this.authState.isLoggedIn()) return undefined;
      return this.appointmentsApi.customerPageUrl(this.currentPage(), 10);
    },
    {
      parse: (raw) => pagedAppointmentResponseSchema.parse(raw),
      defaultValue: {
        content: [],
        page: { number: 0, size: 10, totalElements: 0, totalPages: 1 },
      },
    },
  );

  readonly appointments = computed(() => this.appointmentsResource.value()?.content ?? []);

  // Action-level cancel error surfaced to the UI (e.g. wrong email, already
  // cancelled). Separate from the read-only load errors above.
  readonly cancelErrorMessage = signal<string | null>(null);
  readonly isCancelling = signal<boolean>(false);
  private readonly destroyRef = inject(DestroyRef);

  loadAppointments(): void {
    this.appointmentsResource.reload();
  }

  cancelAppointment(publicId: string): void {
    if (!confirm('Are you sure you want to cancel this appointment?')) return;

    this.cancelErrorMessage.set(null);
    this.isCancelling.set(true);
    this.appointmentsApi
      .cancelCustomerAppointment(publicId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isCancelling.set(false);
          this.cancelErrorMessage.set(null);
          this.loadAppointments();
        },
        error: (err) => {
          this.isCancelling.set(false);
          this.cancelErrorMessage.set(
            extractApiError(err, 'Failed to cancel appointment. Please try again.'),
          );
        },
      });
  }
}
