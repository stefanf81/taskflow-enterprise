import { Component, signal, inject, linkedSignal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { email, form, max, min, required, FormField } from '@angular/forms/signals';
import { AppointmentsApi } from '../../../core/api/appointments-api';
import { ReviewsApi } from '../../../core/api/reviews-api';
import { extractApiError } from '../../../core/api/extract-api-error';
import { normalizePublicId } from '@taskflow/domain';
import { FlashMessages } from '../../../core/ui/flash-messages';
import { ReschedulePicker, RescheduleSelection } from '../../../core/ui/reschedule-picker';
import { ReviewStore } from '../../../core/reviews/review.store';
import { formatLocalDate, formatTime12Hour } from '../../../core/time-utils';

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
 * @defer (on idle; on viewport; hydrate on idle) to keep initial bundle size small.
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
  imports: [CommonModule, FormField, ReschedulePicker],
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

        <!-- Never put verification data in the URL, even before hydration. -->
        <form method="post" (submit)="$event.preventDefault(); onCancel()" class="space-y-4">
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
                [class.block]="cancelForm.publicId().invalid() && cancelForm.publicId().touched()"
                [class.hidden]="
                  !(cancelForm.publicId().invalid() && cancelForm.publicId().touched())
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
                [class.block]="cancelForm.email().invalid() && cancelForm.email().touched()"
                [class.hidden]="!(cancelForm.email().invalid() && cancelForm.email().touched())"
              >
                Valid email is required.
              </span>
            </div>
          </div>
          <div class="flex justify-end pt-2">
            <button
              type="submit"
              class="btn bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-600 hover:text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-all w-full sm:w-auto"
              [disabled]="isCancelling()"
            >
              {{ isCancelling() ? 'Cancelling...' : 'Cancel Reservation' }}
            </button>
          </div>
        </form>
      </section>

      <!-- Self-service reschedule: verified like the cancellation, the booking keeps its code. -->
      <section
        class="card bg-zinc-950 border border-white/10 rounded-3xl p-8 md:order-last md:col-span-2"
      >
        <h2 class="text-lg font-black text-zinc-100 tracking-tight mb-2 flex items-center gap-2">
          <span class="text-gold">🔁</span> Reschedule a Booking
        </h2>
        <p class="text-xs text-zinc-400 font-light leading-relaxed mb-6">
          Need another time? Provide your Booking ID and Email, then pick a new slot. Your booking
          keeps its code, its barber and its service, and the shop confirms the new time again.
        </p>

        <form
          method="post"
          (submit)="$event.preventDefault(); onChooseNewTime()"
          class="grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          <div class="form-group flex flex-col gap-1.5">
            <label
              for="rescheduleBookingId"
              class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
              >Booking ID <span class="required">*</span></label
            >
            <input
              type="text"
              id="rescheduleBookingId"
              [formField]="rescheduleForm.publicId"
              placeholder="e.g., 8f8d9b..."
              class="form-control"
              [attr.aria-invalid]="rescheduleForm.publicId().invalid() ? 'true' : null"
            />
          </div>
          <div class="form-group flex flex-col gap-1.5">
            <label
              for="rescheduleEmail"
              class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
              >Verification Email <span class="required">*</span></label
            >
            <input
              type="email"
              id="rescheduleEmail"
              [formField]="rescheduleForm.email"
              placeholder="e.g., john@example.com"
              class="form-control"
              [attr.aria-invalid]="rescheduleForm.email().invalid() ? 'true' : null"
            />
          </div>
          @if (!rescheduleTarget()) {
            <div class="sm:col-span-2 flex justify-end">
              <button
                type="submit"
                class="btn btn-secondary text-xs font-bold px-5 py-2.5 rounded-xl w-full sm:w-auto"
              >
                Choose a new time
              </button>
            </div>
          }
        </form>
        @if (rescheduleTarget(); as target) {
          <app-reschedule-picker
            [publicId]="target.publicId"
            [email]="target.email"
            [saving]="isRescheduling()"
            (confirmed)="onReschedule($event)"
            (cancelled)="rescheduleTarget.set(null)"
          />
        }
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

        <form method="post" (submit)="$event.preventDefault(); onReview()" class="space-y-4">
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
                [class.block]="reviewForm.publicId().invalid() && reviewForm.publicId().touched()"
                [class.hidden]="
                  !(reviewForm.publicId().invalid() && reviewForm.publicId().touched())
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
                [class.block]="reviewForm.email().invalid() && reviewForm.email().touched()"
                [class.hidden]="!(reviewForm.email().invalid() && reviewForm.email().touched())"
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
                [class.block]="reviewForm.rating().invalid() && reviewForm.rating().touched()"
                [class.hidden]="!(reviewForm.rating().invalid() && reviewForm.rating().touched())"
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
              [disabled]="isReviewing()"
            >
              {{ isReviewing() ? 'Submitting...' : 'Submit Review' }}
            </button>
          </div>
        </form>
      </section>
    </div>
  `,
})
export class PostBookingActionsComponent {
  private readonly appointmentsApi = inject(AppointmentsApi);
  private readonly reviewsApi = inject(ReviewsApi);
  private readonly flash = inject(FlashMessages);
  private readonly reviewStore = inject(ReviewStore);
  private readonly destroyRef = inject(DestroyRef);

  // One in-flight flag per form. Both used to share the booking wizard's submitting flag, so a
  // review in flight relabelled the wizard's button and whichever request finished first
  // re-enabled the other forms while theirs were still pending.
  protected readonly isCancelling = signal(false);
  protected readonly isReviewing = signal(false);

  // Two independent Signal Forms, each with its own validation rules and
  // lifecycle: a cancellation form (publicId + email both required) and a
  // review form (publicId, email, rating required; comment optional).
  readonly cancelModel = signal<CancelFormModel>({ publicId: '', email: '' });
  protected readonly cancelForm = form(this.cancelModel, (f) => {
    required(f.publicId);
    required(f.email);
    email(f.email);
  });

  protected readonly isRescheduling = signal(false);
  readonly rescheduleModel = signal<CancelFormModel>({ publicId: '', email: '' });
  protected readonly rescheduleForm = form(this.rescheduleModel, (f) => {
    required(f.publicId);
    required(f.email);
    email(f.email);
  });
  /**
   * The booking the open slot picker moves (normalized code, trimmed email), or null while it is
   * closed. Fixed when the picker opens, so its availability and the save name the same booking;
   * editing either field closes the picker.
   */
  protected readonly rescheduleTarget = linkedSignal<CancelFormModel, CancelFormModel | null>({
    source: this.rescheduleModel,
    computation: () => null,
  });

  readonly reviewModel = signal<ReviewFormModel>({
    publicId: '',
    email: '',
    rating: 5,
    comment: '',
  });
  protected readonly reviewForm = form(this.reviewModel, (f) => {
    required(f.publicId);
    required(f.email);
    email(f.email);
    required(f.rating);
    min(f.rating, 1);
    max(f.rating, 5);
  });

  onCancel(): void {
    if (this.isCancelling()) return;
    const publicId = normalizePublicId(this.cancelModel().publicId);
    const email = this.cancelModel().email.trim();
    if (!publicId || !email || this.cancelForm().invalid()) {
      this.cancelForm().markAsTouched();
      this.flash.errorMessage.set('Enter your Booking Code and a valid booking email.');
      return;
    }

    this.flash.errorMessage.set(null);
    this.isCancelling.set(true);
    this.appointmentsApi
      .publicCancelAppointment(publicId, email)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isCancelling.set(false);
          this.flash.showSuccess(
            '🗑️ Reservation successfully cancelled. Your time slot has been released.',
          );
          this.cancelForm().reset({ publicId: '', email: '' });
        },
        error: (err) => {
          this.flash.errorMessage.set(
            extractApiError(err, 'Verification failed. Please check your Booking Code and Email.'),
          );
          this.isCancelling.set(false);
        },
      });
  }

  onChooseNewTime(): void {
    const publicId = normalizePublicId(this.rescheduleModel().publicId);
    const email = this.rescheduleModel().email.trim();
    if (!publicId || !email || this.rescheduleForm().invalid()) {
      this.rescheduleForm().markAsTouched();
      this.flash.errorMessage.set('Enter your Booking Code and the email you booked with.');
      return;
    }
    this.flash.errorMessage.set(null);
    this.rescheduleTarget.set({ publicId, email });
  }

  onReschedule(slot: RescheduleSelection): void {
    const target = this.rescheduleTarget();
    if (!target || this.isRescheduling()) return;

    this.flash.errorMessage.set(null);
    this.isRescheduling.set(true);
    this.appointmentsApi
      .publicRescheduleAppointment(target.publicId, { email: target.email, ...slot })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (moved) => {
          this.isRescheduling.set(false);
          // Also closes the picker (see rescheduleTarget).
          this.rescheduleForm().reset({ publicId: '', email: '' });
          this.flash.showSuccess(
            `🔁 Booking moved to ${formatLocalDate(moved.bookingDate)} at ${formatTime12Hour(moved.bookingTime)}. The shop will confirm it again.`,
          );
        },
        error: (err) => {
          this.isRescheduling.set(false);
          this.flash.errorMessage.set(
            extractApiError(
              err,
              'The booking could not be moved. Check your Booking Code and Email, or pick another time.',
            ),
          );
        },
      });
  }

  onReview(): void {
    if (this.isReviewing()) return;
    const publicId = normalizePublicId(this.reviewModel().publicId);
    const email = this.reviewModel().email.trim();
    if (!publicId || !email || this.reviewForm().invalid()) {
      this.reviewForm().markAsTouched();
      this.flash.errorMessage.set(
        'Enter your Booking Code, a valid booking email and a rating from 1 to 5.',
      );
      return;
    }

    this.flash.errorMessage.set(null);
    this.isReviewing.set(true);
    this.reviewsApi
      .submitReview(publicId, {
        rating: this.reviewModel().rating,
        comment: this.reviewModel().comment,
        customerEmail: email,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isReviewing.set(false);
          this.flash.showSuccess('Thank you for your review! We appreciate your feedback.');
          this.reviewStore.loadRatings();
          this.reviewForm().reset({ publicId: '', email: '', rating: 5, comment: '' });
        },
        error: (err) => {
          this.isReviewing.set(false);
          this.flash.errorMessage.set(
            extractApiError(
              err,
              'Failed to submit review. Ensure the code is correct and the appointment is completed.',
            ),
          );
        },
      });
  }
}
