import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, forkJoin, map, merge, of, switchMap } from 'rxjs';
import { appointmentDashboardResponseSchema } from '@taskflow/schemas';
import { toLocalDateString } from '@taskflow/domain';
import { AuthState } from '../../core/auth/auth.state';
import { parseResponse } from '../../core/api/request-validation';
import { SessionEvents } from '../../core/session-events';
import { ShopClock } from '../../core/shop-clock';
import { AppointmentResponse } from '../../types/api';
import { CalendarRange, CalendarView, rangeOf, shiftDate, stepOf } from './admin-calendar';

/** The server's largest page. A week is rarely more than two. */
const PAGE_SIZE = 100;

/**
 * The owner's calendar: which day or week is shown, and the bookings in it.
 *
 * It asks the server for just that range (`from`/`to` on `GET /api/v1/appointments`) and, since a
 * busy week can be longer than one page, fetches the remaining pages in parallel. Changing the
 * view, the day or calling {@link refresh} cancels a load still in flight, so a slow answer for a
 * range the owner has already left never overwrites the one they are looking at.
 */
@Injectable({ providedIn: 'root' })
export class CalendarStore {
  private readonly http = inject(HttpClient);
  private readonly authState = inject(AuthState);
  private readonly shopClock = inject(ShopClock);

  readonly view = signal<CalendarView>('day');
  /** Any date inside what is shown: the day itself, or a day of the week. `YYYY-MM-DD`. */
  readonly anchor = signal<string>(toLocalDateString(this.shopClock.now()));
  readonly range = computed<CalendarRange>(() => rangeOf(this.view(), this.anchor()));

  readonly appointments = signal<readonly AppointmentResponse[]>([]);
  readonly isLoading = signal(false);
  readonly loadError = signal<string | null>(null);
  private readonly reloadTick = signal(0);
  /** A change arrived while a load was running: load once more when it has settled. */
  private refreshPending = false;

  constructor() {
    effect((onCleanup) => {
      if (!this.authState.isLoggedIn() || this.authState.role() !== 'ROLE_ADMIN') return;
      const { from, to } = this.range();
      this.reloadTick();
      untracked(() => {
        // This load starts after every change seen so far, so it answers a pending refresh too.
        this.refreshPending = false;
        this.isLoading.set(true);
        this.loadError.set(null);
      });
      const subscription = this.fetchRange(from, to).subscribe({
        next: (appointments) => {
          this.appointments.set(appointments);
          this.settle();
        },
        // The rows already shown stay: a failed refresh is not an empty day.
        error: () => {
          this.loadError.set('Could not load the calendar. Please retry.');
          this.settle();
        },
      });
      onCleanup(() => subscription.unsubscribe());
    });

    const sessionEvents = inject(SessionEvents);
    merge(sessionEvents.sessionEnded, sessionEvents.unauthorized)
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => {
        this.refreshPending = false;
        this.appointments.set([]);
        this.loadError.set(null);
        this.isLoading.set(false);
      });
  }

  /**
   * Reloads the shown range now; a load already in flight is restarted. For the owner's own
   * actions and the retry button, whose answer must not be an older one.
   */
  refresh(): void {
    this.reloadTick.update((n) => n + 1);
  }

  /**
   * Reloads for a change made elsewhere (the event stream): at once when nothing is loading,
   * otherwise once the running load has settled. Restarting it on every event, as `refresh()`
   * does, kept a multi-page week from ever finishing while a burst of events arrived (a bulk
   * approve, time off cancelling many bookings). Any number of calls during one load cost one
   * extra load, like `AppointmentStore.refreshWhenIdle()`.
   */
  refreshWhenIdle(): void {
    if (this.isLoading()) {
      this.refreshPending = true;
      return;
    }
    this.refresh();
  }

  private settle(): void {
    this.isLoading.set(false);
    if (this.refreshPending) {
      this.refreshPending = false;
      this.refresh();
    }
  }

  setView(view: CalendarView): void {
    this.view.set(view);
  }

  goTo(date: string): void {
    if (date) this.anchor.set(date);
  }

  goToToday(): void {
    this.anchor.set(toLocalDateString(this.shopClock.now()));
  }

  step(direction: 1 | -1): void {
    this.anchor.update((date) => shiftDate(date, direction * stepOf(this.view())));
  }

  private fetchRange(from: string, to: string): Observable<AppointmentResponse[]> {
    const page = (index: number) =>
      this.http
        .get<unknown>('/api/v1/appointments', {
          params: new HttpParams()
            .set('from', from)
            .set('to', to)
            .set('page', index)
            .set('size', PAGE_SIZE),
        })
        .pipe(
          map((raw) =>
            parseResponse(appointmentDashboardResponseSchema, raw, 'GET /api/v1/appointments'),
          ),
        );
    return page(0).pipe(
      switchMap((first) => {
        const more = Array.from({ length: Math.max(first.page.page.totalPages - 1, 0) }, (_, i) =>
          page(i + 1),
        );
        return (more.length === 0 ? of([]) : forkJoin(more)).pipe(
          map((rest) => [first, ...rest].flatMap((response) => response.page.content)),
        );
      }),
    );
  }
}
