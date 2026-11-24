import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { asyncScheduler, throttleTime } from 'rxjs';
import { hoursOn, isoWeekday, parseLocalDate, toLocalDateString } from '@taskflow/domain';
import { ShopClock } from '../../core/shop-clock';
import { formatLocalDate, formatTime12Hour } from '../../core/time-utils';
import { Button } from '../../core/ui/button';
import { EmptyState } from '../../core/ui/empty-state';
import { Icon } from '../../core/ui/icon';
import { StatusBadge } from '../../core/ui/status-badge';
import { xIcon } from '../../core/ui/icons/x';
import { chevronLeftIcon } from '../../core/ui/icons/chevron-left';
import { chevronRightIcon } from '../../core/ui/icons/chevron-right';
import { SegmentedControl, SegmentOption } from '../../core/ui/segmented-control';
import { AppointmentResponse } from '../../types/api';
import { AdminEventsService } from './admin-events.service';
import { AppointmentActions } from './appointment-actions';
import {
  CalendarRow,
  CalendarView,
  SLOT_HOLDING_STATUSES,
  buildGrid,
  calendarHours,
  datesOf,
  hourLabel,
} from './admin-calendar';
import { BarberStore } from './barber.store';
import { CalendarStore } from './calendar.store';

const ALL_BARBERS = '';
const DAY_TITLE = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});
const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

/** A column header of the grid. */
interface CalendarColumn {
  key: string;
  label: string;
  /** Second line: the date number in the week view. */
  detail: string;
  today: boolean;
  /** The shop is closed that day (week view). */
  closed: boolean;
}

/**
 * Owner dashboard · calendar. A day with one column per barber, or a week with one column per day
 * (optionally of a single barber), a row per hour. Only bookings that hold a slot are drawn:
 * pending ones in amber until the owner approves them, approved ones in green.
 */
@Component({
  selector: 'app-admin-calendar-tab',
  imports: [Button, EmptyState, Icon, SegmentedControl, StatusBadge],
  templateUrl: './admin-calendar-tab.html',
})
export class AdminCalendarTab {
  private readonly store = inject(CalendarStore);
  private readonly barberStore = inject(BarberStore);
  private readonly shopClock = inject(ShopClock);
  private readonly actions = inject(AppointmentActions);

  protected readonly view = this.store.view;
  protected readonly anchor = this.store.anchor;
  protected readonly isLoading = this.store.isLoading;
  protected readonly loadError = this.store.loadError;
  protected readonly icons = { previous: chevronLeftIcon, next: chevronRightIcon, close: xIcon };
  protected readonly views: readonly SegmentOption<CalendarView>[] = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
  ];
  protected readonly allBarbers = ALL_BARBERS;
  protected readonly barberFilter = signal(ALL_BARBERS);

  private readonly today = computed(() => toLocalDateString(this.shopClock.now()));
  /** Bookings that hold a slot, in the barber filter (week view). */
  private readonly shown = computed<readonly AppointmentResponse[]>(() => {
    const filter = this.view() === 'week' ? this.barberFilter() : ALL_BARBERS;
    return this.store
      .appointments()
      .filter(
        (appointment) =>
          SLOT_HOLDING_STATUSES.includes(appointment.status) &&
          (filter === ALL_BARBERS || appointment.barberName === filter),
      );
  });

  /** The roster, plus any barber that only appears in a booking (left the shop since). */
  /** The booking whose details are open (by id, so it follows the booking through a reload). */
  protected readonly selectedId = signal<number | null>(null);
  protected readonly selected = computed(
    () => this.shown().find((appointment) => appointment.id === this.selectedId()) ?? null,
  );
  protected readonly pendingIds = this.actions.pendingIds;

  protected readonly barberNames = computed(() => {
    const names = this.barberStore.barbers().map((barber) => barber.name);
    for (const appointment of this.store.appointments()) {
      if (!names.includes(appointment.barberName)) names.push(appointment.barberName);
    }
    return names.sort((a, b) => a.localeCompare(b));
  });

  protected readonly title = computed(() => {
    const { from, to } = this.store.range();
    if (this.view() === 'day') return DAY_TITLE.format(parseLocalDate(from));
    const end = parseLocalDate(to);
    return `${SHORT_DATE.format(parseLocalDate(from))} – ${SHORT_DATE.format(end)}, ${end.getFullYear()}`;
  });

  protected readonly columns = computed<CalendarColumn[]>(() => {
    if (this.view() === 'day') {
      return this.barberNames().map((name) => ({
        key: name,
        label: name,
        detail: '',
        today: false,
        closed: false,
      }));
    }
    const rules = this.shopClock.rules();
    return datesOf(this.store.range()).map((date) => {
      const day = parseLocalDate(date);
      return {
        key: date,
        label: WEEKDAY.format(day),
        detail: String(day.getDate()),
        today: date === this.today(),
        closed: hoursOn(rules, isoWeekday(day)) === undefined,
      };
    });
  });

  protected readonly rows = computed<CalendarRow[]>(() => {
    const day = this.view() === 'day';
    const hours = calendarHours(this.shopClock.rules(), datesOf(this.store.range()), this.shown());
    return buildGrid(
      this.shown(),
      this.columns().map((column) => column.key),
      day ? (appointment) => appointment.barberName : (appointment) => appointment.bookingDate,
      hours,
    );
  });

  protected readonly bookingCount = computed(() =>
    this.rows().reduce((sum, row) => sum + row.cells.reduce((n, cell) => n + cell.length, 0), 0),
  );

  /** A day view on a day the shop is closed says so (any booking left from before is still shown). */
  protected readonly closedNotice = computed(() => {
    if (this.view() !== 'day') return null;
    const date = parseLocalDate(this.anchor());
    return hoursOn(this.shopClock.rules(), isoWeekday(date)) === undefined
      ? 'The shop is closed on this day.'
      : null;
  });

  constructor() {
    this.shopClock.watch(inject(DestroyRef));
    // A booking changed somewhere (a customer booked, another tab approved): refresh what is shown.
    inject(AdminEventsService)
      .appointmentChanges.pipe(
        throttleTime(300, asyncScheduler, { leading: true, trailing: true }),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.store.refresh());
    // The owner approved, denied or cancelled a booking from the panel.
    this.actions.changed.pipe(takeUntilDestroyed()).subscribe(() => this.store.refresh());
  }

  protected select(appointment: AppointmentResponse): void {
    this.selectedId.update((id) => (id === appointment.id ? null : appointment.id));
  }

  protected closeDetails(): void {
    this.selectedId.set(null);
  }

  protected approve(id: number): void {
    this.actions.approve(id);
  }

  protected deny(id: number): void {
    this.actions.deny(id);
  }

  protected cancel(appointment: AppointmentResponse): void {
    this.actions.cancel(appointment);
  }

  protected date(date: string): string {
    return formatLocalDate(date);
  }

  protected setView(view: CalendarView): void {
    this.store.setView(view);
  }

  protected step(direction: 1 | -1): void {
    this.store.step(direction);
  }

  protected goToToday(): void {
    this.store.goToToday();
  }

  protected goTo(date: string): void {
    this.store.goTo(date);
  }

  protected retry(): void {
    this.store.refresh();
  }

  /** The week view's day columns open that day in the day view. */
  protected openDay(date: string): void {
    this.store.goTo(date);
    this.store.setView('day');
  }

  protected setBarber(name: string): void {
    this.barberFilter.set(name);
  }

  protected hourLabel(hour: number): string {
    return hourLabel(hour);
  }

  protected time(time: string): string {
    return formatTime12Hour(time);
  }
}
