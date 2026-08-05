import {
  Component,
  input,
  output,
  signal,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { email, form, max, min, required, FormField } from '@angular/forms/signals';

/** Model shape for the "Cancel my booking" Signal Form. */
interface CancelFormModel {
  publicId: string;
  email: string;
}

/** Model shape for the "Leave a review" Signal Form. */
interface ReviewFormModel {
  publicId: string;
  email: string;
  rating: number;
  comment: string;
}

/**
 * Standalone Post-Booking Actions component.
 *
 * Contains the "Secure Booking Cancellation" and "Submit a Review" forms
 * that appear well below the fold on the guest landing page. Designed for
 * @defer (on viewport) to keep initial bundle size small.
 *
 * Migrated to Angular 22 Signal Forms (`@angular/forms/signals`) to match
 * the booking wizard in `app.ts`: each form is a single signal-backed model
 * bound via `[formRoot]` + per-input `[formField]` directives, replacing the
 * legacy template-driven `FormsModule` + `ngModel` + `#form="ngForm"` pattern.
 * Field-level touched/invalid state now comes from the FieldTree signal
 * accessors (`form.field().invalid()`, `form.field().touched()`) instead of
 * the `ngForm.controls['name']?.invalid` template ref dance.
 */
@Component({
  selector: 'app-post-booking-actions',
  standalone: true,
  imports: [CommonModule, FormField],
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

        <form (submit)="$event.preventDefault(); onCancel()" class="space-y-4">
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
                [formField]="cancelForm.publicId"
                placeholder="e.g., 8f8d9b..."
                class="form-control"
                [attr.aria-invalid]="cancelForm.publicId().invalid() ? 'true' : null"
                aria-describedby="cancelBookingId-error"
              />
              <span
                id="cancelBookingId-error"
                class="text-rose-400 text-[10px]"
                [style.display]="
                  cancelForm.publicId().invalid() && cancelForm.publicId().touched()
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
                [formField]="cancelForm.email"
                placeholder="e.g., john@example.com"
                class="form-control"
                [attr.aria-invalid]="cancelForm.email().invalid() ? 'true' : null"
                aria-describedby="cancelEmail-error"
              />
              <span
                id="cancelEmail-error"
                class="text-rose-400 text-[10px]"
                [style.display]="
                  cancelForm.email().invalid() && cancelForm.email().touched() ? 'block' : 'none'
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
              [disabled]="isSubmitting()"
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

        <form (submit)="$event.preventDefault(); onReview()" class="space-y-4">
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
                [formField]="reviewForm.publicId"
                placeholder="e.g., 8f8d9b..."
                class="form-control"
                [attr.aria-invalid]="reviewForm.publicId().invalid() ? 'true' : null"
                aria-describedby="reviewPublicId-error"
              />
              <span
                id="reviewPublicId-error"
                class="text-rose-400 text-[10px]"
                [style.display]="
                  reviewForm.publicId().invalid() && reviewForm.publicId().touched()
                    ? 'block'
                    : 'none'
                "
              >
                Booking ID is required.
              </span>
            </div>
            <div class="form-group flex flex-col gap-1.5">
              <label
                for="reviewEmail"
                class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
                >Verification Email <span class="required">*</span></label
              >
              <input
                type="email"
                id="reviewEmail"
                [formField]="reviewForm.email"
                placeholder="e.g., john@example.com"
                class="form-control"
                [attr.aria-invalid]="reviewForm.email().invalid() ? 'true' : null"
                aria-describedby="reviewEmail-error"
              />
              <span
                id="reviewEmail-error"
                class="text-rose-400 text-[10px]"
                [style.display]="
                  reviewForm.email().invalid() && reviewForm.email().touched() ? 'block' : 'none'
                "
              >
                Valid email is required.
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
                [formField]="reviewForm.rating"
                class="form-control"
                [attr.aria-invalid]="reviewForm.rating().invalid() ? 'true' : null"
                aria-describedby="reviewRating-error"
              />
              <span
                id="reviewRating-error"
                class="text-rose-400 text-[10px]"
                [style.display]="
                  reviewForm.rating().invalid() && reviewForm.rating().touched() ? 'block' : 'none'
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
                [formField]="reviewForm.comment"
                placeholder="Great haircut!"
                class="form-control min-h-[60px]"
              ></textarea>
            </div>
          </div>
          <div class="flex justify-end pt-2">
            <button
              type="submit"
              class="btn btn-submit text-xs font-bold px-5 py-2.5 rounded-xl transition-all w-full sm:w-auto"
              [disabled]="isSubmitting()"
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
  readonly reviewSubmitted = output<{
    publicId: string;
    rating: number;
    comment: string;
    email: string;
  }>();

  // Two independent Signal Forms, each with its own validation rules and
  // lifecycle: a cancellation form (publicId + email both required) and a
  // review form (publicId, email, rating required; comment optional).
  readonly cancelModel = signal<CancelFormModel>({ publicId: '', email: '' });
  readonly cancelForm = form(this.cancelModel, (f) => {
    required(f.publicId);
    required(f.email);
    email(f.email);
  });

  readonly reviewModel = signal<ReviewFormModel>({
    publicId: '',
    email: '',
    rating: 5,
    comment: '',
  });
  readonly reviewForm = form(this.reviewModel, (f) => {
    required(f.publicId);
    required(f.email);
    email(f.email);
    required(f.rating);
    min(f.rating, 1);
    max(f.rating, 5);
  });

  onCancel(): void {
    const publicId = this.cancelModel().publicId.trim();
    const email = this.cancelModel().email.trim();
    if (publicId && email) {
      this.cancelRequested.emit({ publicId, email });
      this.cancelModel.set({ publicId: '', email: '' });
    }
  }

  onReview(): void {
    const publicId = this.reviewModel().publicId.trim();
    const email = this.reviewModel().email.trim();
    if (publicId && email) {
      this.reviewSubmitted.emit({
        publicId,
        rating: this.reviewModel().rating,
        comment: this.reviewModel().comment,
        email,
      });
      this.reviewModel.set({ publicId: '', email: '', rating: 5, comment: '' });
    }
  }
}
