import { Injectable, signal, computed, inject, effect, untracked, DestroyRef } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthState } from './auth.state';
import { AppointmentDashboardResponse } from './types/api';
import { AppointmentsApi } from './core/api/appointments-api';
import { extractApiError } from './core/api/extract-api-error';
import { refreshResource, safeResourceValue } from './core/resource-utils';
import { SessionEvents } from './core/session-events';
import { appointmentDashboardResponseSchema } from '@taskflow/schemas';

const EMPTY_DASHBOARD: AppointmentDashboardResponse = {
  page: {
    content: [],
    page: { number: 0, size: 50, totalElements: 0, totalPages: 1 },
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
};

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
 * - `refresh()` is reserved for cases where no reactive signal changed but the
 *   server data may have (approve/deny/delete success, Sync DB button, SSE event).
 *   It never drops a refresh: `reload()` is a no-op while a load is in flight, so
 *   `refresh()` falls back to bumping a counter the request function reads, which
 *   restarts the load.
 * - Reading `resource.value()` THROWS while the resource is in the error state, so
 *   every list the UI reads is derived from a safe view (`safeResourceValue`).
 */
@Injectable({ providedIn: 'root' })
export class AppointmentStore {
  private readonly appointmentsApi = inject(AppointmentsApi);
  private readonly sessionEvents = inject(SessionEvents);
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

  /** Read by the resource request so a refresh can restart an in-flight load. */
  private readonly refreshTick = signal(0);

  // Core Admin Reactive States (Declarative Signals via httpResource)
  private readonly appointmentsResource = httpResource<AppointmentDashboardResponse>(
    () => {
      // The listing is admin-only on the backend: any other signed-in role would just
      // collect a 403 on every login and refresh.
      if (!this.authState.isLoggedIn() || this.authState.role() !== 'ROLE_ADMIN') return undefined;
      this.refreshTick();
      return this.appointmentsApi.dashboardUrl(
        this.selectedFilter(),
        this.searchDebounced(),
        this.currentPage(),
        this.pageSize,
      );
    },
    {
      parse: (raw) => appointmentDashboardResponseSchema.parse(raw),
      defaultValue: EMPTY_DASHBOARD,
    },
  );

  // Error-safe view: the empty dashboard (never a throw) while loading or failed.
  private readonly dashboard = safeResourceValue(this.appointmentsResource, EMPTY_DASHBOARD);

  readonly appointments = computed(() => this.dashboard().page.content);
  readonly stats = computed(() => this.dashboard().stats);
  readonly totalPages = computed(() => this.dashboard().page.page.totalPages);
  readonly totalElements = computed(() => this.dashboard().page.page.totalElements);

  // Load-failure state kept separate from the dismissible action `errorMessage`,
  // which is shared with BookingStore and must not carry dashboard load errors.
  readonly isLoading = this.appointmentsResource.isLoading;
  readonly loadErrorMessage = computed(() =>
    this.appointmentsResource.error() ? 'Could not load appointments. Please retry.' : null,
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

    // When an authenticated session ends (logout, 401 expiry) drop everything the
    // previous user left behind: page, filters, search and banners. Done on the
    // event (not in an effect) so it runs BEFORE a failed action's error callback
    // and can never erase the message that action sets afterwards.
    this.sessionEvents.sessionEnded
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.resetSessionState());

    // Approving/denying/deleting under a status filter (or an SSE refresh) can
    // leave the current page past the last one. Clamp back once the server has
    // answered. Only a RESOLVED response counts: while a new page is loading the
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
    this.refresh();
  }

  /** Refetch now; a request already in flight is restarted rather than the refresh dropped. */
  refresh(): void {
    refreshResource(this.appointmentsResource, this.refreshTick);
  }

  /**
   * Signs out. The session stays alive (and the user stays on the dashboard)
   * until the server confirms: a failed logout leaves a still-valid HttpOnly
   * cookie, so pretending to be signed out would be a lie. Resolves `true` once
   * signed out; `false` after showing an error and keeping the session.
   */
  async onLogout(): Promise<boolean> {
    try {
      await this.authState.logoutAndWait();
      return true;
    } catch (err) {
      this.errorMessage.set(
        extractApiError(err, 'Could not sign out. Please check your connection and try again.'),
      );
      return false;
    }
  }

  /**
   * Reports a failed admin action. A 401 is skipped: the session-expiry flow
   * already told the user (and navigated away); a stale "Failed to approve"
   * banner would just leak onto the landing page's shared alert area.
   */
  reportActionError(err: unknown, fallback: string): void {
    if ((err as { status?: number })?.status === 401) return;
    this.errorMessage.set(extractApiError(err, fallback));
  }

  private resetSessionState(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
    if (this.successTimer) {
      clearTimeout(this.successTimer);
      this.successTimer = null;
    }
    this.currentPage.set(0);
    this.selectedFilter.set('all');
    this.searchQuery.set('');
    this.searchDebounced.set('');
    this.errorMessage.set(null);
    this.successMessage.set(null);
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
