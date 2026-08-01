import { Injectable, signal, computed, inject, DestroyRef } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthState } from './auth.state';
import {
  AppointmentService,
  AppointmentItem,
  AppointmentStats,
  AppointmentDashboardResponse,
} from './appointment.service';

/**
 * Admin appointment list state.
 *
 * Fetch orchestration notes (B1):
 * - `httpResource` re-fires automatically whenever the signals read inside its
 *   request function change (and cancels any in-flight request). Filter and
 *   page changes therefore MUST NOT call `reload()` as well — that would fire
 *   two identical requests per action.
 * - Search is debounced: the input binds to `searchQuery`, but the resource
 *   reads the separate `searchDebounced` signal, so typing does not trigger a
 *   request per keystroke and the 300ms coalescing window actually works.
 * - `reload()` is reserved for cases where no reactive signal changed but the
 *   server data may have (approve/deny/delete success, Sync DB button, login).
 */
@Injectable({ providedIn: 'root' })
export class AppointmentStore {
  private readonly appointmentService = inject(AppointmentService);
  private readonly authState = inject(AuthState);
  private readonly destroyRef = inject(DestroyRef);

  // Authentication State — delegates to AuthState (single source of truth).
  // The JWT is held in an HttpOnly cookie (not readable by JS). The UI auth
  // state is derived purely from signals, restored on refresh via /auth/me.

  // Pagination & Filter States
  readonly currentPage = signal<number>(0);
  readonly pageSize = 50;
  readonly selectedFilter = signal<string>('all');
  readonly searchQuery = signal<string>('');
  /** Debounced copy of searchQuery — the only search signal the resource reads. */
  readonly searchDebounced = signal<string>('');

  // Core Admin Reactive States (Declarative Signals via httpResource)
  private readonly appointmentsResource = httpResource<AppointmentDashboardResponse>(
    () => {
      if (!this.authState.isLoggedIn()) return undefined;
      let url = `/api/v1/appointments?page=${this.currentPage()}&size=${this.pageSize}`;
      const filter = this.selectedFilter();
      if (filter && filter !== 'all') {
        url += `&status=${filter.toUpperCase()}`;
      }
      const search = this.searchDebounced();
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

  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // React to 401s anywhere in the app by clearing client-side auth state.
    // Register cleanup via DestroyRef so the listener is removed when the
    // injector is destroyed (e.g. on hot-reload or lazy-module teardown).
    if (typeof window !== 'undefined') {
      const handler = () => this.resetAuthState();
      window.addEventListener('auth:unauthorized', handler);
      this.destroyRef.onDestroy(() => window.removeEventListener('auth:unauthorized', handler));
    }
    this.destroyRef.onDestroy(() => {
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }
    });
  }

  /**
   * Debounced search entry point (bound to the search input). Only
   * `searchDebounced` drives the resource, so a typing burst coalesces into a
   * single request after 300ms of inactivity.
   */
  onSearchChange(value: string): void {
    this.searchQuery.set(value);
    this.currentPage.set(0); // Reset page
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    this.searchDebounceTimer = setTimeout(() => {
      this.searchDebounceTimer = null;
      this.searchDebounced.set(value);
    }, 300);
  }

  /** Filter change — resource reactivity refetches; no manual reload (avoids double fetch). */
  setFilter(filter: string): void {
    this.selectedFilter.set(filter);
    this.currentPage.set(0);
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

  /**
   * Forces an explicit refetch — used when the server data changed without any
   * reactive signal changing (approve/deny/delete success, Sync DB button).
   */
  loadAppointments(selectedFilter?: string, searchQuery?: string): void {
    if (selectedFilter !== undefined) this.selectedFilter.set(selectedFilter);
    if (searchQuery !== undefined) {
      this.searchQuery.set(searchQuery);
      this.searchDebounced.set(searchQuery);
    }
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
    this.authState.clear();
    this.errorMessage.set(null);
  }
}
