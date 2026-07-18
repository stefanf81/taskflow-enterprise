import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

/** Reusable FAQ accordion. Used inline (deferred) on the home page and as the /faq route. */
@Component({
  selector: 'app-faq',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-full px-4 sm:px-8 lg:px-16 pt-12">
      <section class="card bg-zinc-950 border border-white/10 rounded-3xl p-8 mt-16">
        <h2 class="text-center text-lg font-extrabold text-zinc-100 uppercase tracking-tight mb-6">
          💬 Frequently Asked Questions
        </h2>
        <div class="space-y-4 max-w-3xl mx-auto text-xs">
          <div class="border-b border-white/5 pb-4">
            <button
              type="button"
              (click)="toggle(0)"
              class="w-full text-left bg-none border-none text-zinc-100 font-bold text-sm cursor-pointer flex justify-between items-center outline-none"
            >
              <span>⏰ How early should I arrive for my appointment?</span>
              <span class="text-indigo-400 font-extrabold">{{ active() === 0 ? '−' : '+' }}</span>
            </button>
            @if (active() === 0) {
              <p class="text-zinc-400 font-light leading-relaxed mt-2 pl-1 animate-fadeIn">
                We recommend arriving 5–10 minutes early. This gives you plenty of time to enjoy a
                complimentary beverage (premium coffee, cold beer, or water) and settle in before
                your service begins.
              </p>
            }
          </div>
          <div class="border-b border-white/5 pb-4">
            <button
              type="button"
              (click)="toggle(1)"
              class="w-full text-left bg-none border-none text-zinc-100 font-bold text-sm cursor-pointer flex justify-between items-center outline-none"
            >
              <span>💳 Do you accept credit cards and contactless payments?</span>
              <span class="text-indigo-400 font-extrabold">{{ active() === 1 ? '−' : '+' }}</span>
            </button>
            @if (active() === 1) {
              <p class="text-zinc-400 font-light leading-relaxed mt-2 pl-1 animate-fadeIn">
                Yes! We accept all major credit cards, Apple Pay, Google Pay, and standard
                contactless payments at check-out. No prepayment is required when submitting your
                booking request online.
              </p>
            }
          </div>
          <div class="border-b border-white/5 pb-4">
            <button
              type="button"
              (click)="toggle(2)"
              class="w-full text-left bg-none border-none text-zinc-100 font-bold text-sm cursor-pointer flex justify-between items-center outline-none"
            >
              <span>📅 What is your cancellation/rescheduling policy?</span>
              <span class="text-indigo-400 font-extrabold">{{ active() === 2 ? '−' : '+' }}</span>
            </button>
            @if (active() === 2) {
              <p class="text-zinc-400 font-light leading-relaxed mt-2 pl-1 animate-fadeIn">
                We understand plans change! If you need to cancel or reschedule, please click the
                cancellation link in your approval email or call us directly at least 12 hours
                before your scheduled slot.
              </p>
            }
          </div>
        </div>
      </section>
    </div>
  `,
})
export class Faq {
  readonly active = signal<number | null>(null);

  toggle(index: number): void {
    this.active.set(this.active() === index ? null : index);
  }
}
