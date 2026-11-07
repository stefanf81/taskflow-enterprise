import { Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { AppointmentsApi } from '../../../core/api/appointments-api';
import { extractApiError } from '../../../core/api/extract-api-error';
import { downloadTextFile, ICS_MIME_TYPE } from '../../../core/download';
import { AppointmentItem } from '../../../types/api';
import { formatTime12Hour, formatLocalDate } from '../../../core/time-utils';

@Component({
  selector: 'app-receipt-modal',
  standalone: true,
  imports: [CommonModule, A11yModule],
  template: `
    <div
      class="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn"
      tabindex="-1"
      (click)="onBackdropClick($event)"
      (keydown.escape)="closed.emit()"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="receiptModalTitle"
        cdkTrapFocus
        cdkTrapFocusAutoCapture
        class="login-card modal-card receipt-modal-card animate-fadeIn p-8 rounded-3xl border border-white/10 shadow-2xl shadow-black/50"
      >
        <button
          type="button"
          cdkFocusInitial
          class="modal-close"
          aria-label="Close"
          (click)="closed.emit()"
        >
          &times;
        </button>
        <div class="login-header text-center mb-6">
          <div
            class="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="3"
              stroke="currentColor"
              class="w-6 h-6 text-emerald-600"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h2
            id="receiptModalTitle"
            class="text-xl font-black text-zinc-100 tracking-tight uppercase"
          >
            Reservation Requested!
          </h2>
          <p class="text-xs text-zinc-500 leading-normal mt-1">
            Your luxury grooming slot has been successfully registered.
          </p>
        </div>

        <div class="bg-black border border-white/10 rounded-2xl p-5 mb-5 animate-fadeIn">
          <h3
            class="text-center font-bold text-xs text-zinc-500 uppercase tracking-wider pb-3 border-b border-white/10 mb-4"
          >
            Receipt #{{ appointment()?.id }}
          </h3>

          <div class="space-y-3 text-xs text-zinc-400 font-light">
            <p class="flex justify-between">
              <span>🔑 Booking Code:</span>
              <strong class="text-gold font-bold select-all">{{ appointment()?.publicId }}</strong>
            </p>
            <p class="flex justify-between">
              <span>👤 Customer:</span>
              <strong class="text-zinc-100 font-semibold">{{ appointment()?.customerName }}</strong>
            </p>
            <p class="flex justify-between">
              <span>✂️ Service:</span>
              <strong class="text-zinc-100 font-semibold">{{ appointment()?.serviceType }}</strong>
            </p>
            <p class="flex justify-between">
              <span>💈 Stylist:</span>
              <strong class="text-zinc-100 font-semibold">{{ appointment()?.barberName }}</strong>
            </p>
            <p class="flex justify-between">
              <span>📅 Scheduled:</span>
              <strong class="text-zinc-100 font-semibold"
                >{{ formatLocalDate(appointment()?.bookingDate ?? '') }} at
                {{ formatTime12Hour(appointment()?.bookingTime ?? '') }}</strong
              >
            </p>
            <hr class="border-t border-dashed border-slate-300 my-2" />
            <p class="flex justify-between text-sm font-bold text-zinc-100 pt-1">
              <span>Estimated Price:</span>
              <span class="text-gold">\${{ checkoutTotal() | number: '1.2-2' }}</span>
            </p>
          </div>
        </div>

        <div class="text-center text-[11px] text-zinc-500 leading-relaxed font-light mb-6">
          <p class="font-bold text-zinc-300 mb-1">📝 What happens next?</p>
          <p>
            The shop owner will review your slot request and confirm it. Keep your booking code:
            with your email address it lets you cancel, reschedule or review this booking.
          </p>
        </div>

        <div class="space-y-2.5">
          <button
            type="button"
            class="btn btn-secondary w-full py-2.5 text-xs font-bold tracking-wide uppercase"
            [disabled]="exportingCalendar() || !appointment()"
            (click)="downloadCalendar()"
          >
            {{ exportingCalendar() ? 'Exporting Calendar…' : '📅 Download .ics Calendar' }}
          </button>
          @if (calendarError(); as message) {
            <p role="alert" class="text-center text-[11px] text-rose-400">{{ message }}</p>
          }
          <button
            type="button"
            class="btn btn-submit w-full py-3 font-bold tracking-wide uppercase"
            (click)="closed.emit()"
          >
            Got It, Thanks!
          </button>
        </div>
      </div>
    </div>
  `,
})
export class ReceiptModalComponent {
  private readonly appointmentsApi = inject(AppointmentsApi);
  private readonly destroyRef = inject(DestroyRef);
  readonly appointment = input<AppointmentItem | null>(null);
  readonly checkoutTotal = input(0);
  readonly closed = output<void>();
  protected readonly exportingCalendar = signal(false);
  protected readonly calendarError = signal<string | null>(null);

  protected downloadCalendar(): void {
    const appt = this.appointment();
    if (!appt || this.exportingCalendar()) return;
    this.exportingCalendar.set(true);
    this.calendarError.set(null);
    this.appointmentsApi
      .exportPublicCalendar(appt.publicId, appt.customerEmail)
      .pipe(
        finalize(() => this.exportingCalendar.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ content, filename }) => {
          if (!downloadTextFile(content, filename, ICS_MIME_TYPE)) {
            this.calendarError.set('This browser cannot save the calendar file.');
          }
        },
        error: (err: unknown) =>
          this.calendarError.set(
            extractApiError(err, 'The calendar file could not be created. Please try again.'),
          ),
      });
  }

  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closed.emit();
    }
  }

  protected formatTime12Hour(timeStr: string): string {
    return formatTime12Hour(timeStr);
  }

  protected formatLocalDate(dateStr: string): string {
    return formatLocalDate(dateStr);
  }
}
