import { Injectable, signal, computed, inject, effect, untracked, DestroyRef } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthState } from '../../core/auth/auth.state';
import { AppointmentDashboardResponse } from '../../types/api';
import { AppointmentsApi } from '../../core/api/appointments-api';
import { refreshResource, safeResourceValue } from '../../core/resource-utils';
import { SessionEvents } from '../../core/session-events';
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
 * Owner dashboard: the appointment list (page, status filter, search) and its stats.
 *
 * Action messages ("Appointment APPROVED!", "Failed to delete booking.") go to the app-wide
 * banner, `FlashMessages`; this store only reports its own load failure (`loadErrorMessage`).
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
 *   server data may have (approve/deny/delete success, Sync DB button, Retry).
 *   It never drops a refresh: `reload()` is a no-op while a load is in flight, so
 *   `refresh()` falls back to bumping a counter the request function reads, which
 *   restarts the load.
 * - `refreshWhenIdle()` is for changes other people make (the SSE stream). It lets a load
 *   in flight finish and follows it with exactly one more: restarting on every event kept
 *   cancelling the list under a steady stream of events whenever a load took longer than
 *   the gap between them, and a cancelled request may still have run its queries.
 * - Reading `resource.value()` THROWS while the resource is in the error state, so
 *   every list the UI reads is derived from a safe view (`safeResourceValue`).
 */
@Injectable({ providedIn: 'root' })
export class AppointmentStore {
  private readonly appointmentsApi = inject(AppointmentsApi);
  private readonly sessionEvents = inject(SessionEvents);
  private readonly authState = inject(AuthState);
  private readonly destroyRef = inject(DestroyRef);

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

  /** A change arrived while a load was running: load once more when it settles. */
  private refreshPending = false;

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

  // Load-failure state, kept apart from the dismissible app-wide banner (FlashMessages): a
  // failed list load must read as "could not load", never as "no bookings".
  readonly isLoading = this.appointmentsResource.isLoading;
  readonly loadErrorMessage = computed(() =>
    this.appointmentsResource.error() ? 'Could not load appointments. Please retry.' : null,
  );

  constructor() {
    this.destroyRef.onDestroy(() => this.cancelSearchDebounce());

    // When an authenticated session ends (logout, 401 expiry) drop what the previous user left
    // behind: page, filter and search.
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

    // The follow-up load of refreshWhenIdle(), once the load it waited for has settled (or
    // dropped when the listing went idle, i.e. the admin signed out).
    effect(() => {
      const status = this.appointmentsResource.status();
      if (!this.refreshPending || status === 'loading' || status === 'reloading') return;
      this.refreshPending = false;
      if (status !== 'idle') untracked(() => this.refresh());
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
    this.cancelSearchDebounce();
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
   * Refetch for a change made elsewhere: at once when nothing is loading, otherwise once the
   * running load has settled. Any number of calls during one load cost one extra request.
   */
  refreshWhenIdle(): void {
    if (this.appointmentsResource.isLoading()) {
      this.refreshPending = true;
      return;
    }
    this.refresh();
  }

  private resetSessionState(): void {
    this.refreshPending = false;
    this.cancelSearchDebounce();
    this.currentPage.set(0);
    this.selectedFilter.set('all');
    this.searchQuery.set('');
    this.searchDebounced.set('');
  }

  private cancelSearchDebounce(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
  }
}
