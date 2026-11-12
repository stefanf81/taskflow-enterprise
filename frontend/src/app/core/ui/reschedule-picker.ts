import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { httpResource } from '@angular/common/http';
import {
  DEFAULT_TIME_SLOTS,
  formatTime12Hour,
  isSlotInPast,
  openSlotsOn,
  parseLocalDate,
  rescheduleDates,
} from '@taskflow/domain';
import { AppointmentsApi } from '../api/appointments-api';
import { extractApiError } from '../api/extract-api-error';
import { refreshResource, safeResourceValue } from '../resource-utils';
import { ShopClock } from '../shop-clock';

/** The slot a booking should move to. */
export interface RescheduleSelection {
  bookingDate: string;
  bookingTime: string;
}

/**
 * Picks a new date and time for an existing booking: the shop's open days inside the booking
 * window, and the slots of the chosen day within its opening hours that have not started and
 * that the server offers for this booking (its own barber and booked length, the booking itself
 * not counted, so a service renamed or retired since does not matter). A guest proves the booking
 * with its email. Shared by the customer portal and the guest post-booking actions.
 */
@Component({
  selector: 'app-reschedule-picker',
  template: `
    <div
      class="p-3 rounded-xl border border-white/10 bg-zinc-900/60 space-y-3 mt-1"
      role="group"
      aria-label="Choose a new date and time"
    >
      <div>
        <p class="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1.5">New date</p>
        <div class="flex flex-wrap gap-1.5">
          @for (date of dates(); track date) {
            <button
              type="button"
              class="px-2.5 py-1.5 rounded-lg text-[11px] border transition-all"
              [class]="
                date === selectedDate()
                  ? 'bg-gold/20 border-gold text-gold'
                  : 'border-white/10 text-zinc-300 hover:border-white/30'
              "
              [attr.aria-pressed]="date === selectedDate()"
              (click)="selectedDate.set(date)"
            >
              {{ shortDate(date) }}
            </button>
          } @empty {
            <p class="text-xs text-zinc-500">No open days in the booking window.</p>
          }
        </div>
      </div>

      <div>
        <p class="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1.5">New time</p>
        @if (loadingSlots()) {
          <p class="text-xs text-zinc-500" role="status">Checking availability…</p>
        } @else if (slotsError()) {
          <div class="flex items-center gap-2" role="alert">
            <p class="text-xs text-rose-400">{{ slotsError() }}</p>
            <button type="button" class="btn btn-secondary py-1 px-2 text-[11px]" (click)="retry()">
              Retry
            </button>
          </div>
        } @else {
          <div class="flex flex-wrap gap-1.5">
            @for (slot of slots(); track slot) {
              <button
                type="button"
                class="px-2.5 py-1.5 rounded-lg text-[11px] border transition-all"
                [class]="
                  slot === selectedTime()
                    ? 'bg-gold/20 border-gold text-gold'
                    : 'border-white/10 text-zinc-300 hover:border-white/30'
                "
                [attr.aria-pressed]="slot === selectedTime()"
                (click)="selectedTime.set(slot)"
              >
                {{ formatTime12Hour(slot) }}
              </button>
            } @empty {
              <p class="text-xs text-zinc-500">No free time on this day.</p>
            }
          </div>
        }
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="btn btn-submit py-1.5 px-3 text-xs"
          [disabled]="saving() || !selectedDate() || !selectedTime()"
          (click)="confirm()"
        >
          {{ saving() ? 'Saving…' : 'Save new time' }}
        </button>
        <button
          type="button"
          class="btn btn-secondary py-1.5 px-3 text-xs"
          [disabled]="saving()"
          (click)="cancelled.emit()"
        >
          Close
        </button>
      </div>
    </div>
  `,
})
export class ReschedulePicker {
  private readonly shopClock = inject(ShopClock);
  private readonly appointmentsApi = inject(AppointmentsApi);

  constructor() {
    this.shopClock.watch?.(inject(DestroyRef));
  }

  /** The booking to move; a guest also passes the email it was booked with. */
  readonly publicId = input.required<string>();
  readonly email = input<string | null>(null);
  /** Where the booking is now (`YYYY-MM-DD`, `HH:mm`): preselected, and no move to itself. */
  readonly currentDate = input('');
  readonly currentTime = input('');
  readonly saving = input(false);
  readonly confirmed = output<RescheduleSelection>();
  readonly cancelled = output<void>();

  protected readonly dates = computed(() =>
    rescheduleDates(this.shopClock.now(), this.shopClock.rules(), DEFAULT_TIME_SLOTS),
  );
  protected readonly selectedDate = linkedSignal(() => {
    const dates = this.dates();
    return dates.includes(this.currentDate()) ? this.currentDate() : (dates[0] ?? '');
  });
  protected readonly selectedTime = linkedSignal({
    source: this.selectedDate,
    computation: () => '',
  });

  private readonly refreshTick = signal(0);
  private readonly busyResource = httpResource<string[]>(
    () => {
      this.refreshTick();
      const publicId = this.publicId();
      const date = this.selectedDate();
      if (!publicId || !date) return undefined;
      const email = this.email();
      return email
        ? this.appointmentsApi.publicRescheduleAvailabilityRequest(publicId, email, date)
        : this.appointmentsApi.customerRescheduleAvailabilityRequest(publicId, date);
    },
    {
      defaultValue: [],
      parse: (raw) => this.appointmentsApi.parseRescheduleAvailability(raw, !!this.email()),
    },
  );
  private readonly busy = safeResourceValue(this.busyResource, []);

  protected readonly loadingSlots = this.busyResource.isLoading;
  /** The server's reason (a wrong code or email, a booking that can no longer move) or a fallback. */
  protected readonly slotsError = computed(() => {
    const error = this.busyResource.error();
    return error ? extractApiError(error, 'Availability could not be loaded.') : null;
  });

  protected readonly slots = computed(() => {
    const date = this.selectedDate();
    const current = this.currentTime().slice(0, 5);
    return openSlotsOn(
      date,
      this.shopClock.now(),
      this.shopClock.rules(),
      DEFAULT_TIME_SLOTS,
      this.busy(),
    ).filter((slot) => !(date === this.currentDate() && slot === current));
  });

  protected retry(): void {
    refreshResource(this.busyResource, this.refreshTick);
  }

  protected confirm(): void {
    const bookingDate = this.selectedDate();
    const bookingTime = this.selectedTime();
    if (!bookingDate || !bookingTime || this.saving()) return;
    this.shopClock.tick?.();
    if (isSlotInPast(bookingDate, bookingTime, this.shopClock.now())) {
      this.selectedTime.set('');
      return;
    }
    this.confirmed.emit({ bookingDate, bookingTime });
  }

  protected shortDate(dateStr: string): string {
    const date = parseLocalDate(dateStr);
    return Number.isNaN(date.getTime()) ? dateStr : SHORT_DATE_FORMAT.format(date);
  }

  protected formatTime12Hour(time24: string): string {
    return formatTime12Hour(time24);
  }
}

const SHORT_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
