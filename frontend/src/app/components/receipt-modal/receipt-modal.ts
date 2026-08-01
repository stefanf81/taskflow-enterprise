import { Component, ChangeDetectionStrategy, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppointmentItem } from '../../appointment.service';
import { formatTime12Hour, formatLocalDate } from '../../time-utils';

@Component({
  selector: 'app-receipt-modal',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn"
      (click)="close.emit()"
      (keydown.escape)="close.emit()"
    >
      <div
        (click)="$event.stopPropagation()"
        role="dialog"
        aria-modal="true"
        aria-label="Booking confirmation"
        class="login-card modal-card animate-fadeIn p-8 rounded-3xl border border-white/10 shadow-2xl shadow-black/50"
        style="max-width: 480px"
      >
        <button class="modal-close" (click)="close.emit()">&times;</button>
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
          <h2 class="text-xl font-black text-zinc-100 tracking-tight uppercase">
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
            Receipt #{{ appointment?.id }}
          </h3>

          <div class="space-y-3 text-xs text-zinc-400 font-light">
            <p class="flex justify-between">
              <span>🔑 Booking Code:</span>
              <strong class="text-gold font-bold select-all">{{ appointment?.publicId }}</strong>
            </p>
            <p class="flex justify-between">
              <span>👤 Customer:</span>
              <strong class="text-zinc-100 font-semibold">{{ appointment?.customerName }}</strong>
            </p>
            <p class="flex justify-between">
              <span>✂️ Service:</span>
              <strong class="text-zinc-100 font-semibold">{{ appointment?.serviceType }}</strong>
            </p>
            <p class="flex justify-between">
              <span>💈 Stylist:</span>
              <strong class="text-zinc-100 font-semibold">{{ appointment?.barberName }}</strong>
            </p>
            <p class="flex justify-between">
              <span>📅 Scheduled:</span>
              <strong class="text-zinc-100 font-semibold"
                >{{ formatLocalDate(appointment?.bookingDate ?? '') }} at
                {{ formatTime12Hour(appointment?.bookingTime ?? '') }}</strong
              >
            </p>
            <hr class="border-t border-dashed border-slate-300 my-2" />
            <p class="flex justify-between text-sm font-bold text-zinc-100 pt-1">
              <span>Estimated Price:</span>
              <span class="text-gold">\${{ checkoutTotal | number: '1.2-2' }}</span>
            </p>
          </div>
        </div>

        <div class="text-center text-[11px] text-zinc-500 leading-relaxed font-light mb-6">
          <p class="font-bold text-zinc-300 mb-1">📝 What happens next?</p>
          <p>
            The shop owner will review your slot request. Once approved, you will automatically
            receive a simulated SMTP email notification confirming your reservation details.
          </p>
        </div>

        <button
          type="button"
          class="btn btn-submit w-full py-3 font-bold tracking-wide uppercase"
          (click)="close.emit()"
        >
          Got It, Thanks!
        </button>
      </div>
    </div>
  `,
})
export class ReceiptModalComponent {
  @Input() appointment: AppointmentItem | null = null;
  @Input() checkoutTotal = 0;
  @Output() close = new EventEmitter<void>();

  formatTime12Hour(timeStr: string): string {
    return formatTime12Hour(timeStr);
  }

  formatLocalDate(dateStr: string): string {
    return formatLocalDate(dateStr);
  }
}
