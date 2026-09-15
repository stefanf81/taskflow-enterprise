import { Injectable, signal, computed, inject, effect, DestroyRef } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthState } from './auth.state';
import { AppointmentDashboardResponse } from './types/api';
import { AppointmentsApi } from './core/api/appointments-api';
import { AuthApi } from './core/api/auth-api';
import { appointmentDashboardResponseSchema } from '@taskflow/schemas';

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
  private readonly appointmentsApi = inject(AppointmentsApi);
  private readonly authApi = inject(AuthApi);
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

  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Core Admin Reactive States (Declarative Signals via httpResource)
  private readonly appointmentsResource = httpResource<AppointmentDashboardResponse>(
    () => {
      if (!this.authState.isLoggedIn()) return undefined;
      return this.appointmentsApi.dashboardUrl(
        this.selectedFilter(),
        this.searchDebounced(),
        this.currentPage(),
        this.pageSize,
      );
    },
    {
      parse: (raw) => appointmentDashboardResponseSchema.parse(raw),
      defaultValue: {
        page: {
          content: [],
          page: {
            number: 0,
            size: 50,
            totalElements: 0,
            totalPages: 1,
          },
        },
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
  readonly totalPages = computed(
    () => this.appointmentsResource.value()?.page.page.totalPages ?? 1,
  );
  readonly totalElements = computed(
    () => this.appointmentsResource.value()?.page.page.totalElements ?? 0,
  );

  // Alerts & Loading State (Signals)
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly isSubmitting = signal<boolean>(false);
  readonly isCheckingSlots = signal<boolean>(false);
  readonly busySlots = signal<string[]>([]);

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }
      if (this.successTimer) {
        clearTimeout(this.successTimer);
      }
    });

    // A 401 on a protected request clears the session (AuthState). Drop any
    // stale banner as well so a logged-out dashboard never shows an alert
    // from the previous session.
    effect(() => {
      if (!this.authState.isLoggedIn()) {
        this.errorMessage.set(null);
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

  // Handle Admin Logout — drop UI state before the request returns: the landing
  // page redirects any still-signed-in role back to its dashboard, so a late
  // clear would bounce the user to /admin while the logout POST is in flight.
  onLogout(): void {
    this.resetAuthState();
    this.authApi
      .logout()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () => this.resetAuthState(),
      });
  }

  // Reset local auth signals (also invoked when the session is dropped by a 401).
  resetAuthState(): void {
    this.authState.clear();
    this.errorMessage.set(null);
  }

  private successTimer: ReturnType<typeof setTimeout> | null = null;

  /** Shows a transient success banner (auto-dismissed after 4.5s). */
  showSuccess(message: string): void {
    if (this.successTimer) {
      clearTimeout(this.successTimer);
    }
    this.successMessage.set(message);
    this.successTimer = setTimeout(() => {
      this.successMessage.set(null);
      this.successTimer = null;
    }, 4500);
  }
}
