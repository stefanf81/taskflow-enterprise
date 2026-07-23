import {
  Component,
  input,
  output,
  signal,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/**
 * Standalone Post-Booking Actions component.
 *
 * Contains the "Secure Booking Cancellation" and "Submit a Review" forms
 * that appear well below the fold on the guest landing page. Designed for
 * @defer (on viewport) to keep initial bundle size small.
 */
@Component({
  selector: 'app-post-booking-actions',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
      <!-- Interactive secure self-service cancellation portal -->
      <section class="card bg-zinc-950 border border-white/10 rounded-3xl p-8">
        <h2 class="text-lg font-black text-zinc-100 tracking-tight mb-2 flex items-center gap-2">
          <span class="text-rose-500">🧹</span> Secure Booking Cancellation
        </h2>
        <p class="text-xs text-zinc-400 font-light leading-relaxed mb-6">
          Need to cancel your reservation? Provide your Booking ID and Email below to delete your
          scheduled slot instantly from our calendar:
        </p>

        <form (ngSubmit)="onCancel()" #cancelForm="ngForm" class="space-y-4">
          <div class="flex flex-col gap-4">
            <div class="form-group flex flex-col gap-1.5">
              <label
                for="cancelBookingId"
                class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
                >Booking ID <span class="required">*</span></label
              >
              <input
                type="text"
                id="cancelBookingId"
                name="cancelBookingId"
                [ngModel]="cancelId()"
                (ngModelChange)="cancelId.set($event)"
                required
                placeholder="e.g., 8f8d9b..."
                class="form-control"
                [attr.aria-invalid]="
                  cancelForm.controls['cancelBookingId']?.invalid ? 'true' : null
                "
                aria-describedby="cancelBookingId-error"
              />
              <span
                id="cancelBookingId-error"
                class="text-rose-400 text-[10px]"
                [style.display]="
                  cancelForm.controls['cancelBookingId']?.invalid &&
                  cancelForm.controls['cancelBookingId']?.touched
                    ? 'block'
                    : 'none'
                "
              >
                Booking ID is required.
              </span>
            </div>
            <div class="form-group flex flex-col gap-1.5">
              <label
                for="cancelEmail"
                class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
                >Verification Email <span class="required">*</span></label
              >
              <input
                type="email"
                id="cancelEmail"
                name="cancelEmail"
                [ngModel]="cancelEmail()"
                (ngModelChange)="cancelEmail.set($event)"
                required
                placeholder="e.g., john@example.com"
                class="form-control"
                [attr.aria-invalid]="cancelForm.controls['cancelEmail']?.invalid ? 'true' : null"
                aria-describedby="cancelEmail-error"
              />
              <span
                id="cancelEmail-error"
                class="text-rose-400 text-[10px]"
                [style.display]="
                  cancelForm.controls['cancelEmail']?.invalid &&
                  cancelForm.controls['cancelEmail']?.touched
                    ? 'block'
                    : 'none'
                "
              >
                Valid email is required.
              </span>
            </div>
          </div>
          <div class="flex justify-end pt-2">
            <button
              type="submit"
              class="btn bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/100 hover:text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-all w-full sm:w-auto"
              [disabled]="cancelForm.invalid || isSubmitting()"
            >
              {{ isSubmitting() ? 'Cancelling...' : 'Cancel Reservation' }}
            </button>
          </div>
        </form>
      </section>

      <!-- Interactive secure self-service review portal -->
      <section class="card bg-zinc-950 border border-white/10 rounded-3xl p-8">
        <h2 class="text-lg font-black text-zinc-100 tracking-tight mb-2 flex items-center gap-2">
          <span class="text-amber-400">⭐</span> Submit a Review
        </h2>
        <p class="text-xs text-zinc-400 font-light leading-relaxed mb-6">
          Did you enjoy your haircut? Provide your Booking ID to leave a public rating and review
          for your barber!
        </p>

        <form (ngSubmit)="onReview()" #reviewForm="ngForm" class="space-y-4">
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
                [ngModel]="reviewPublicId()"
                (ngModelChange)="reviewPublicId.set($event)"
                required
                placeholder="e.g., 8f8d9b..."
                class="form-control"
                [attr.aria-invalid]="reviewForm.controls['reviewPublicId']?.invalid ? 'true' : null"
                aria-describedby="reviewPublicId-error"
              />
              <span
                id="reviewPublicId-error"
                class="text-rose-400 text-[10px]"
                [style.display]="
                  reviewForm.controls['reviewPublicId']?.invalid &&
                  reviewForm.controls['reviewPublicId']?.touched
                    ? 'block'
                    : 'none'
                "
              >
                Booking ID is required.
              </span>
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
                [ngModel]="reviewRating()"
                (ngModelChange)="reviewRating.set(+$event)"
                required
                min="1"
                max="5"
                class="form-control"
                [attr.aria-invalid]="reviewForm.controls['reviewRating']?.invalid ? 'true' : null"
                aria-describedby="reviewRating-error"
              />
              <span
                id="reviewRating-error"
                class="text-rose-400 text-[10px]"
                [style.display]="
                  reviewForm.controls['reviewRating']?.invalid &&
                  reviewForm.controls['reviewRating']?.touched
                    ? 'block'
                    : 'none'
                "
              >
                Rating between 1 and 5 is required.
              </span>
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
                [ngModel]="reviewComment()"
                (ngModelChange)="reviewComment.set($event)"
                placeholder="Great haircut!"
                class="form-control min-h-[60px]"
              ></textarea>
            </div>
          </div>
          <div class="flex justify-end pt-2">
            <button
              type="submit"
              class="btn btn-submit text-xs font-bold px-5 py-2.5 rounded-xl transition-all w-full sm:w-auto"
              [disabled]="reviewForm.invalid || isSubmitting()"
            >
              {{ isSubmitting() ? 'Submitting...' : 'Submit Review' }}
            </button>
          </div>
        </form>
      </section>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class PostBookingActionsComponent {
  readonly isSubmitting = input(false);

  /** Emitted when the user submits a cancellation request. */
  readonly cancelRequested = output<{ publicId: string; email: string }>();
  /** Emitted when the user submits a review. */
  readonly reviewSubmitted = output<{ publicId: string; rating: number; comment: string }>();

  readonly cancelId = signal('');
  readonly cancelEmail = signal('');
  readonly reviewPublicId = signal('');
  readonly reviewRating = signal(5);
  readonly reviewComment = signal('');

  onCancel(): void {
    const publicId = this.cancelId().trim();
    const email = this.cancelEmail().trim();
    if (publicId && email) {
      this.cancelRequested.emit({ publicId, email });
      this.cancelId.set('');
      this.cancelEmail.set('');
    }
  }

  onReview(): void {
    const publicId = this.reviewPublicId().trim();
    if (publicId) {
      this.reviewSubmitted.emit({
        publicId,
        rating: this.reviewRating(),
        comment: this.reviewComment(),
      });
      this.reviewPublicId.set('');
      this.reviewComment.set('');
      this.reviewRating.set(5);
    }
  }
}
