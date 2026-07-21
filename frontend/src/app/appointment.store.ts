import { Service, signal, computed, inject, DestroyRef } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AppointmentService,
  AppointmentItem,
  AppointmentStats,
  AppointmentDashboardResponse,
} from './appointment.service';

@Service()
export class AppointmentStore {
  private readonly appointmentService = inject(AppointmentService);

  // Authentication State.
  // The JWT is held in an HttpOnly cookie (not readable by JS). The UI auth
  // state is derived purely from signals, restored on refresh via /auth/me.
  readonly isLoggedIn = signal<boolean>(false);

  // Pagination & Filter States
  readonly currentPage = signal<number>(0);
  readonly pageSize = 50;
  readonly selectedFilter = signal<string>('all');
  readonly searchQuery = signal<string>('');

  // Core Admin Reactive States (Declarative Signals via httpResource)
  private readonly appointmentsResource = httpResource<AppointmentDashboardResponse>(
    () => {
      if (!this.isLoggedIn()) return undefined;
      let url = `/api/v1/appointments?page=${this.currentPage()}&size=${this.pageSize}`;
      const filter = this.selectedFilter();
      if (filter && filter !== 'all') {
        url += `&status=${filter.toUpperCase()}`;
      }
      const search = this.searchQuery();
      if (search) {
        url += `&search=${encodeURIComponent(search)}`;
      }
      return url;
    },
    {
      defaultValue: {
        page: { content: [], totalPages: 1, totalElements: 0, size: 50, number: 0 },
        stats: {
          total: 0,
          pending: 0,
          approved: 0,
          denied: 0,
          overdue: 0,
          progress: 0,
          approvedRevenue: 0,
        },
      },
    },
  );

  readonly appointments = computed(() => this.appointmentsResource.value()?.page.content ?? []);
  readonly stats = computed(
    () =>
      this.appointmentsResource.value()?.stats ?? {
        total: 0,
        pending: 0,
        approved: 0,
        denied: 0,
        overdue: 0,
        progress: 0,
        approvedRevenue: 0,
      },
  );
  readonly totalPages = computed(() => this.appointmentsResource.value()?.page.totalPages ?? 1);
  readonly totalElements = computed(
    () => this.appointmentsResource.value()?.page.totalElements ?? 0,
  );

  // Alerts & Loading State (Signals)
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly isSubmitting = signal<boolean>(false);
  readonly isCheckingSlots = signal<boolean>(false);
  readonly busySlots = signal<string[]>([]);
  private readonly destroyRef = inject(DestroyRef);

  // Compat method to force reload
  loadAppointments(selectedFilter?: string, searchQuery?: string): void {
    if (selectedFilter !== undefined) this.selectedFilter.set(selectedFilter);
    if (searchQuery !== undefined) this.searchQuery.set(searchQuery);
    this.appointmentsResource.reload();
  }

  // Handle Admin Logout — clear the HttpOnly cookie on the backend, then drop UI state.
  onLogout(): void {
    this.appointmentService
      .logout()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.resetAuthState(),
        error: () => this.resetAuthState(),
      });
  }

  // Reset local auth signals (also invoked on a 401 from the interceptor).
  resetAuthState(): void {
    this.isLoggedIn.set(false);
    this.errorMessage.set(null);
  }

  constructor() {
    // React to 401s anywhere in the app by clearing client-side auth state.
    if (typeof window !== 'undefined') {
      window.addEventListener('auth:unauthorized', () => this.resetAuthState());
    }
  }
}
