import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { merge } from 'rxjs';
import { extractApiError } from '../api/extract-api-error';
import { SessionEvents } from '../session-events';

/** How long a success banner stays up before it dismisses itself. */
export const SUCCESS_BANNER_MS = 4500;

/**
 * The app-wide alert banner: one dismissible error and one transient success message.
 *
 * Written by the booking wizard, the guest cancel/review forms, the landing page's sign-in
 * hand-off and both dashboards; rendered by the wizard (guest page and `/customer/book`), the
 * owner dashboard and the customer portal. A message belongs to the visitor who caused it, so
 * the banner is wiped when an authenticated session ends and when someone signs in. Both happen
 * on the {@link SessionEvents} event itself (not in an effect), so the reset runs before a failed
 * action's error callback and can never erase the message that callback sets afterwards.
 */
@Injectable({ providedIn: 'root' })
export class FlashMessages {
  private readonly destroyRef = inject(DestroyRef);
  private successTimer: ReturnType<typeof setTimeout> | null = null;

  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  constructor() {
    const sessionEvents = inject(SessionEvents);
    merge(sessionEvents.sessionEnded, sessionEvents.sessionStarted)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.clear());
    this.destroyRef.onDestroy(() => this.cancelSuccessTimer());
  }

  /** Shows a transient success banner (auto-dismissed after {@link SUCCESS_BANNER_MS}). */
  showSuccess(message: string): void {
    this.cancelSuccessTimer();
    this.successMessage.set(message);
    this.successTimer = setTimeout(() => {
      this.successMessage.set(null);
      this.successTimer = null;
    }, SUCCESS_BANNER_MS);
  }

  /**
   * Reports a failed action of a signed-in user. A 401 is skipped: the session-expiry flow
   * already told the user (and navigated away); a stale "Failed to approve" banner would just
   * leak onto the landing page.
   */
  reportActionError(err: unknown, fallback: string): void {
    if ((err as { status?: number } | null)?.status === 401) return;
    this.errorMessage.set(extractApiError(err, fallback));
  }

  /** Drops both messages (and a pending auto-dismiss). */
  clear(): void {
    this.cancelSuccessTimer();
    this.errorMessage.set(null);
    this.successMessage.set(null);
  }

  private cancelSuccessTimer(): void {
    if (this.successTimer) {
      clearTimeout(this.successTimer);
      this.successTimer = null;
    }
  }
}
