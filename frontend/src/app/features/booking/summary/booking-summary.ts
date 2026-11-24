import { Component, inject } from '@angular/core';
import { formatLocalDate, formatTime12Hour } from '../../../core/time-utils';
import { BookingStore } from '../booking.store';
import { alarmClockIcon } from '../../../core/ui/icons/alarm-clock';
import { calendarIcon } from '../../../core/ui/icons/calendar';
import { clipboardListIcon } from '../../../core/ui/icons/clipboard-list';
import { scissorsIcon } from '../../../core/ui/icons/scissors';
import { timerIcon } from '../../../core/ui/icons/timer';
import { userRoundIcon } from '../../../core/ui/icons/user-round';
import { Icon } from '../../../core/ui/icon';

/**
 * The reservation so far: treatment, duration, stylist, day and time, estimated end and price.
 *
 * Shown beside the steps on a desktop (the wizard's sticky aside) and above the confirm button of
 * step 4 on a phone. It reads {@link BookingStore} like the steps do, so it stays correct while the
 * visitor moves back and forth. The day and time only count once step 3 is valid: a preselected
 * time that turned out to be taken is not shown as if it were booked.
 */
@Component({
  selector: 'app-booking-summary',
  imports: [Icon],
  template: `
    <div class="booking-summary-card card p-5">
      <h3
        class="text-zinc-100 font-extrabold text-sm border-b border-white/10 pb-3 mb-4 flex items-center gap-1.5"
      >
        <span><app-icon [icon]="icons.clipboardList" /> Reservation Summary</span>
      </h3>
      <div class="space-y-3 text-xs text-zinc-400 font-light">
        <p class="flex justify-between gap-3">
          <span><app-icon [icon]="icons.scissors" /> Treatment:</span>
          <strong class="text-zinc-100 font-semibold text-right">{{
            store.bookingService() || 'Choose a treatment'
          }}</strong>
        </p>
        <p class="flex justify-between gap-3">
          <span><app-icon [icon]="icons.timer" /> Duration:</span>
          <strong class="text-zinc-100 font-semibold">
            @if (store.selectedServiceObj(); as service) {
              {{ service.durationMinutes }} mins
            } @else {
              &mdash;
            }
          </strong>
        </p>
        <p class="flex justify-between gap-3">
          <span><app-icon [icon]="icons.userRound" /> Stylist:</span>
          <strong class="text-zinc-100 font-semibold text-right">{{
            store.bookingBarber() || 'Choose a stylist'
          }}</strong>
        </p>
        <p class="flex justify-between gap-3">
          <span><app-icon [icon]="icons.calendar" /> Scheduled:</span>
          <strong class="text-zinc-100 font-semibold text-right">
            @if (!store.bookingDate()) {
              Pick a day
            } @else if (store.isStepValid(3)) {
              {{ formatLocalDate(store.bookingDate()) }} at
              {{ formatTime12Hour(store.bookingTime()) }}
            } @else {
              {{ formatLocalDate(store.bookingDate()) }}, pick a time
            }
          </strong>
        </p>
        @if (store.isStepValid(3) && store.estimatedEndTime()) {
          <p class="flex justify-between gap-3">
            <span><app-icon [icon]="icons.alarmClock" /> Est. End Time:</span>
            <strong class="text-accent font-bold">{{
              formatTime12Hour(store.estimatedEndTime())
            }}</strong>
          </p>
        }
        <hr class="border-t border-white/10 my-2" />
        <p class="flex justify-between text-sm font-bold text-zinc-100 pt-1">
          <span>Total Est. Price:</span>
          <span class="text-accent">{{ store.formattedTotal() }}</span>
        </p>
      </div>
    </div>
  `,
})
export class BookingSummary {
  protected readonly icons = {
    alarmClock: alarmClockIcon,
    calendar: calendarIcon,
    clipboardList: clipboardListIcon,
    scissors: scissorsIcon,
    timer: timerIcon,
    userRound: userRoundIcon,
  };
  protected readonly store = inject(BookingStore);
  protected readonly formatTime12Hour = formatTime12Hour;
  protected readonly formatLocalDate = formatLocalDate;
}
