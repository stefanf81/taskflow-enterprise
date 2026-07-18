import { Component, model, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** Self-service review submission portal. Used inline on home and as the /reviews route. */
@Component({
  selector: 'app-review-portal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card bg-zinc-950 border border-white/10 rounded-3xl p-8">
      <h2 class="text-lg font-black text-zinc-100 tracking-tight mb-2 flex items-center gap-2">
        <span class="text-amber-400">⭐</span> Submit a Review
      </h2>
      <p class="text-xs text-zinc-400 font-light leading-relaxed mb-6">
        Did you enjoy your haircut? Provide your Booking ID to leave a public rating and review for
        your barber!
      </p>

      <form (ngSubmit)="submitted.emit()" #reviewForm="ngForm" class="space-y-4">
        <div class="flex flex-col gap-4">
          <div class="form-group flex flex-col gap-1.5">
            <label
              for="reviewPublicId"
              class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
              >Booking ID <span class="required">*</span></label
            >
            <input
              type="text"
              id="reviewPublicId"
              name="reviewPublicId"
              [(ngModel)]="publicId"
              required
              placeholder="e.g., 8f8d9b..."
              class="form-control"
            />
          </div>
          <div class="form-group flex flex-col gap-1.5">
            <label
              for="reviewRating"
              class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
              >Rating (1-5) <span class="required">*</span></label
            >
            <input
              type="number"
              id="reviewRating"
              name="reviewRating"
              [(ngModel)]="rating"
              required
              min="1"
              max="5"
              class="form-control"
            />
          </div>
          <div class="form-group flex flex-col gap-1.5">
            <label
              for="reviewComment"
              class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
              >Comment (Optional)</label
            >
            <textarea
              id="reviewComment"
              name="reviewComment"
              [(ngModel)]="comment"
              placeholder="Great haircut!"
              class="form-control min-h-[60px]"
            ></textarea>
          </div>
        </div>
        <div class="flex justify-end pt-2">
          <button
            type="submit"
            class="btn btn-submit text-xs font-bold px-5 py-2.5 rounded-xl transition-all w-full sm:w-auto"
            [disabled]="reviewForm.invalid"
          >
            Submit Review
          </button>
        </div>
      </form>
    </section>
  `,
})
export class ReviewPortal {
  readonly publicId = model('');
  readonly rating = model(5);
  readonly comment = model('');
  readonly submitted = output<void>();
}
