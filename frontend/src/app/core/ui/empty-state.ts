import { Component, computed, input } from '@angular/core';
import { Icon } from './icon';
import { hourglassIcon } from './icons/hourglass';
import { inboxIcon } from './icons/inbox';
import { triangleExclamationPointIcon } from './icons/triangle-exclamation-point';

export type EmptyStateKind = 'empty' | 'loading' | 'error';

/**
 * The placeholder a list shows instead of rows: nothing there yet, still loading, or failed.
 *
 * `<app-empty-state kind="error" [title]="loadError()"><button appButton="secondary">Retry</button></app-empty-state>`
 *
 * Loading is a polite `role="status"`, an error `role="alert"`. Projected content (a Retry or
 * "Book now" button) goes under the text. `icon` overrides the kind's default icon.
 */
@Component({
  selector: 'app-empty-state',
  imports: [Icon],
  template: `
    <app-icon
      [icon]="shownIcon()"
      class="size-8 mx-auto mb-2"
      [class.animate-pulse]="kind() === 'loading'"
      [class.text-danger]="kind() === 'error'"
      [class.text-fg-subtle]="kind() !== 'error'"
    />
    <h3 class="text-white font-bold text-sm">{{ title() }}</h3>
    @if (description()) {
      <p class="text-xs text-zinc-500 font-light mt-1">{{ description() }}</p>
    }
    <div class="empty-state-actions mt-4 empty:hidden"><ng-content /></div>
  `,
  host: {
    class:
      'block text-center py-12 px-4 border border-dashed border-white/10 rounded-2xl bg-raised/20',
    '[attr.role]': "kind() === 'error' ? 'alert' : kind() === 'loading' ? 'status' : null",
  },
})
export class EmptyState {
  readonly kind = input<EmptyStateKind>('empty');
  readonly title = input.required<string>();
  readonly description = input<string>('');
  /** A `core/ui/icons/<name>.ts` path; defaults to an inbox, an hourglass or a warning sign. */
  readonly icon = input<string>();

  protected readonly shownIcon = computed(() => this.icon() ?? DEFAULT_ICONS[this.kind()]);
}

const DEFAULT_ICONS: Record<EmptyStateKind, string> = {
  empty: inboxIcon,
  loading: hourglassIcon,
  error: triangleExclamationPointIcon,
};
