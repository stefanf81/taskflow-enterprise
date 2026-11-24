import { Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { announcementSchema } from '@taskflow/schemas';
import { AnnouncementApi } from '../../core/api/announcement-api';
import { extractApiError } from '../../core/api/extract-api-error';
import { ShopClock } from '../../core/shop-clock';
import { Alert } from '../../core/ui/alert';
import { Button } from '../../core/ui/button';

/** The backend's limit (V45): the prerendered landing page reserves room for this much text. */
export const ANNOUNCEMENT_MAX_LENGTH = 120;

/**
 * Owner dashboard · service catalog tab · the promo strip at the top of both landing pages. Saving
 * an empty text turns the strip off. The current text comes from the shop info, which is reloaded
 * after a save so this tab shows what guests will see.
 */
@Component({
  selector: 'app-admin-announcement',
  imports: [Alert, Button],
  template: `
    <section class="space-y-3" aria-labelledby="announcement-heading">
      <div>
        <h3 id="announcement-heading" class="text-white font-bold text-lg">Landing announcement</h3>
        <p class="text-xs text-zinc-400 font-light">
          The strip at the top of the website and the app. Leave it empty to hide it.
        </p>
      </div>

      @if (actionSuccess(); as message) {
        <app-alert tone="success" dismissible (dismissed)="actionSuccess.set(null)">
          {{ message }}
        </app-alert>
      }
      @if (actionError(); as message) {
        <app-alert tone="error" dismissible (dismissed)="actionError.set(null)">
          {{ message }}
        </app-alert>
      }

      <form class="space-y-3" novalidate (submit)="save($event)">
        <label for="announcement-message" class="sr-only">Announcement text</label>
        <textarea
          id="announcement-message"
          class="form-control w-full"
          rows="2"
          autocomplete="off"
          [attr.maxlength]="maxLength"
          aria-describedby="announcement-count"
          [disabled]="isSaving() || !shop.loaded()"
          [value]="draft()"
          (input)="draft.set($any($event.target).value)"
        ></textarea>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <span id="announcement-count" class="text-xs text-zinc-500">
            {{ draft().length }} / {{ maxLength }} characters
          </span>
          <div class="flex gap-2">
            <button
              type="button"
              appButton="secondary"
              [disabled]="isSaving() || !shop.announcement()"
              (click)="submit('')"
            >
              Hide the strip
            </button>
            <button type="submit" appButton [disabled]="isSaving() || !shop.loaded()">
              {{ isSaving() ? 'Saving…' : 'Save announcement' }}
            </button>
          </div>
        </div>
      </form>
    </section>
  `,
})
export class AdminAnnouncement {
  private readonly api = inject(AnnouncementApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly shop = inject(ShopClock);
  protected readonly maxLength = ANNOUNCEMENT_MAX_LENGTH;

  protected readonly draft = signal('');
  protected readonly isSaving = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected readonly actionSuccess = signal<string | null>(null);

  constructor() {
    // Start from the published text, and follow it when the shop info is reloaded.
    effect(() => {
      const current = this.shop.announcement();
      untracked(() => this.draft.set(current));
    });
  }

  protected save(event: Event): void {
    event.preventDefault();
    this.submit(this.draft());
  }

  protected submit(message: string): void {
    if (this.isSaving()) return;
    const parsed = announcementSchema.safeParse({ message: message.trim() || undefined });
    if (!parsed.success) {
      this.actionError.set(parsed.error.issues[0]?.message ?? 'Please check the announcement.');
      return;
    }
    this.isSaving.set(true);
    this.actionError.set(null);
    this.actionSuccess.set(null);
    this.api
      .updateAnnouncement(parsed.data)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (saved) => {
          this.isSaving.set(false);
          this.actionSuccess.set(saved.active ? 'Announcement saved.' : 'The strip is hidden.');
          this.shop.reload();
        },
        error: (error) => {
          this.isSaving.set(false);
          this.actionError.set(
            extractApiError(error, 'Could not save the announcement. Please try again.'),
          );
        },
      });
  }
}
