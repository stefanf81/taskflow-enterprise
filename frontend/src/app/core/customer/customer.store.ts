import { Injectable, signal, computed, inject, effect, untracked, DestroyRef } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthState } from '../auth/auth.state';
import { AppointmentPage } from '../../types/api';
import { AppointmentsApi } from '../api/appointments-api';
import { extractApiError } from '../api/extract-api-error';
import { refreshResource, safeResourceValue } from '../resource-utils';
import { SessionEvents } from '../session-events';
import { FlashMessages } from '../ui/flash-messages';
import { downloadTextFile, ICS_MIME_TYPE } from '../download';
import { finalize } from 'rxjs';
import { pagedAppointmentResponseSchema } from '@taskflow/schemas';

const EMPTY_PAGE: AppointmentPage = {
  content: [],
  page: { number: 0, size: 10, totalElements: 0, totalPages: 1 },
};

@Injectable({ providedIn: 'root' })
export class CustomerStore {
  private readonly appointmentsApi = inject(AppointmentsApi);
  private readonly authState = inject(AuthState);
  private readonly sessionEvents = inject(SessionEvents);
  readonly currentPage = signal<number>(0);
  readonly pageSize = 10;

  /** Read by the resource request so a refresh can restart an in-flight load. */
  private readonly refreshTick = signal(0);

  // Gated on auth: httpResource fires eagerly on creation, so without this
  // guard every guest visit would fire a 401 against a protected endpoint at
  // boot (and churn the auth:unauthorized handler). The request starts
  // reactively once AuthState flips to logged-in.
  private readonly appointmentsResource = httpResource<AppointmentPage>(
    () => {
      // Customers only: an admin has no bookings under /customer (and no portal).
      if (!this.authState.isLoggedIn() || this.authState.role() !== 'ROLE_CUSTOMER') {
        return undefined;
      }
      this.refreshTick();
      return this.appointmentsApi.customerPageUrl(this.currentPage(), this.pageSize);
    },
    {
      parse: (raw) => pagedAppointmentResponseSchema.parse(raw),
      defaultValue: EMPTY_PAGE,
    },
  );

  // Error-safe view: reading the raw resource value throws while it is in the error state.
  private readonly page = safeResourceValue(this.appointmentsResource, EMPTY_PAGE);

  readonly appointments = computed(() => this.page().content);
  readonly totalPages = computed(() => this.page().page.totalPages);
  readonly totalElements = computed(() => this.page().page.totalElements);

  // Load-failure state kept separate from the dismissible app-wide banner
  // (FlashMessages), so a failed list load never masquerades as "no bookings".
  readonly isLoading = this.appointmentsResource.isLoading;
  readonly loadErrorMessage = computed(() =>
    this.appointmentsResource.error() ? 'Could not load your appointments. Please retry.' : null,
  );

  // Action-level cancel error surfaced to the UI (e.g. wrong email, already
  // cancelled). Separate from the read-only load errors above.
  readonly cancelErrorMessage = signal<string | null>(null);
  readonly isCancelling = signal<boolean>(false);
  /** The booking whose move is in flight (one at a time), or null. */
  readonly reschedulingId = signal<string | null>(null);
  /** The booking whose calendar file is being fetched, or null. */
  readonly exportingId = signal<string | null>(null);
  private readonly flash = inject(FlashMessages);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Per-user state must not outlive the session (shared devices, switching accounts).
    this.sessionEvents.sessionEnded
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.resetSessionState());

    // Cancelling the last row of the last page (or an out-of-range page after a
    // refresh) would leave an empty page behind: step back once the server has
    // answered. Only a RESOLVED response counts — while a new page loads the
    // resource reports its default (1 page), which must not trigger a clamp.
    effect(() => {
      if (this.appointmentsResource.status() !== 'resolved') return;
      const totalPages = this.totalPages();
      const page = untracked(this.currentPage);
      if (page > 0 && page >= totalPages) {
        this.currentPage.set(Math.max(0, totalPages - 1));
      }
    });
  }

  loadAppointments(): void {
    refreshResource(this.appointmentsResource, this.refreshTick);
  }

  /** Page change — resource reactivity refetches; no manual reload. */
  setPage(page: number): void {
    if (page >= 0 && page < this.totalPages()) {
      this.currentPage.set(page);
    }
  }

  nextPage(): void {
    this.setPage(this.currentPage() + 1);
  }

  prevPage(): void {
    this.setPage(this.currentPage() - 1);
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
          // A 401 is the session-expiry flow's job (notice + login prompt).
          if ((err as { status?: number })?.status === 401) return;
          this.cancelErrorMessage.set(
            extractApiError(err, 'Failed to cancel appointment. Please try again.'),
          );
        },
      });
  }

  /** Saves one of the customer's bookings as an .ics file; errors go to the app-wide banner. */
  exportCalendar(publicId: string): void {
    if (this.exportingId()) return;
    this.flash.errorMessage.set(null);
    this.exportingId.set(publicId);
    this.appointmentsApi
      .exportCustomerCalendar(publicId)
      .pipe(
        finalize(() => this.exportingId.set(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ content, filename }) => {
          if (!downloadTextFile(content, filename, ICS_MIME_TYPE)) {
            this.flash.errorMessage.set('This browser cannot save the calendar file.');
          }
        },
        // A 401 is the session-expiry flow's job (notice + login prompt).
        error: (err) =>
          this.flash.reportActionError(
            err,
            'Failed to export the calendar file. Please try again.',
          ),
      });
  }

  /**
   * Moves a booking to another slot (same barber and service; approval starts again). Resolves
   * whether it moved; a failure is reported on the app-wide banner.
   */
  rescheduleAppointment(
    publicId: string,
    bookingDate: string,
    bookingTime: string,
  ): Promise<boolean> {
    if (this.reschedulingId()) return Promise.resolve(false);
    this.flash.errorMessage.set(null);
    this.reschedulingId.set(publicId);
    return new Promise<boolean>((resolve) => {
      this.appointmentsApi
        .rescheduleCustomerAppointment(publicId, { bookingDate, bookingTime })
        .pipe(
          finalize(() => this.reschedulingId.set(null)),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe({
          next: () => {
            this.loadAppointments();
            resolve(true);
          },
          error: (err) => {
            this.flash.reportActionError(
              err,
              'Failed to reschedule the appointment. Please try again.',
            );
            resolve(false);
          },
        });
    });
  }

  private resetSessionState(): void {
    this.currentPage.set(0);
    this.cancelErrorMessage.set(null);
    this.isCancelling.set(false);
    this.reschedulingId.set(null);
    this.exportingId.set(null);
  }
}
