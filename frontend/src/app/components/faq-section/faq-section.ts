import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-faq-section',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card bg-zinc-950 border border-white/10 rounded-3xl p-8 mt-16">
      <h2 class="text-center text-lg font-extrabold text-zinc-100 uppercase tracking-tight mb-6">
        💬 Frequently Asked Questions
      </h2>
      <div class="space-y-4 max-w-3xl mx-auto text-xs">
        <div class="border-b border-white/5 pb-4">
          <button
            type="button"
            id="faq-btn-0"
            (click)="toggleFaq(0)"
            [attr.aria-expanded]="activeFaq() === 0"
            aria-controls="faq-panel-0"
            class="w-full text-left bg-none border-none text-zinc-100 font-bold text-sm cursor-pointer flex justify-between items-center outline-none"
          >
            <span>⏰ How early should I arrive for my appointment?</span>
            <span class="text-gold font-extrabold">{{ activeFaq() === 0 ? '−' : '+' }}</span>
          </button>
          @if (activeFaq() === 0) {
            <div id="faq-panel-0" role="region" aria-labelledby="faq-btn-0" class="animate-fadeIn">
              <p class="text-zinc-400 font-light leading-relaxed mt-2 pl-1">
                We recommend arriving 5–10 minutes early. This gives you plenty of time to enjoy a
                complimentary beverage (premium coffee, cold beer, or water) and settle in before
                your service begins.
              </p>
            </div>
          }
        </div>
        <div class="border-b border-white/5 pb-4">
          <button
            type="button"
            id="faq-btn-1"
            (click)="toggleFaq(1)"
            [attr.aria-expanded]="activeFaq() === 1"
            aria-controls="faq-panel-1"
            class="w-full text-left bg-none border-none text-zinc-100 font-bold text-sm cursor-pointer flex justify-between items-center outline-none"
          >
            <span>💳 Do you accept credit cards and contactless payments?</span>
            <span class="text-gold font-extrabold">{{ activeFaq() === 1 ? '−' : '+' }}</span>
          </button>
          @if (activeFaq() === 1) {
            <div id="faq-panel-1" role="region" aria-labelledby="faq-btn-1" class="animate-fadeIn">
              <p class="text-zinc-400 font-light leading-relaxed mt-2 pl-1">
                Yes! We accept all major credit cards, Apple Pay, Google Pay, and standard cash.
              </p>
            </div>
          }
        </div>
        <div class="pb-2">
          <button
            type="button"
            id="faq-btn-2"
            (click)="toggleFaq(2)"
            [attr.aria-expanded]="activeFaq() === 2"
            aria-controls="faq-panel-2"
            class="w-full text-left bg-none border-none text-zinc-100 font-bold text-sm cursor-pointer flex justify-between items-center outline-none"
          >
            <span>🔄 What is your cancellation policy?</span>
            <span class="text-gold font-extrabold">{{ activeFaq() === 2 ? '−' : '+' }}</span>
          </button>
          @if (activeFaq() === 2) {
            <div id="faq-panel-2" role="region" aria-labelledby="faq-btn-2" class="animate-fadeIn">
              <p class="text-zinc-400 font-light leading-relaxed mt-2 pl-1">
                You can cancel or reschedule your reservation up to 2 hours prior to your scheduled
                time through the online confirmation modal or by calling the shop directly.
              </p>
            </div>
          }
        </div>
      </div>
    </section>
  `,
})
export class FaqSectionComponent {
  readonly activeFaq = signal<number | null>(null);

  toggleFaq(index: number): void {
    this.activeFaq.update((current) => (current === index ? null : index));
  }
}
