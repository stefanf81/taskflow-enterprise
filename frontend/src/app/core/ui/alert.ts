import { Component, booleanAttribute, computed, input, output } from '@angular/core';
import { Icon } from './icon';
import { circleCheckIcon } from './icons/circle-check';
import { circleExclamationPointIcon } from './icons/circle-exclamation-point';
import { infoIcon } from './icons/info';
import { triangleExclamationPointIcon } from './icons/triangle-exclamation-point';

export type AlertTone = 'error' | 'warning' | 'success' | 'info';

const TONE: Record<AlertTone, string> = {
  error: 'danger',
  warning: 'warning',
  success: 'success',
  info: 'neutral',
};

const ICONS: Record<AlertTone, string> = {
  error: circleExclamationPointIcon,
  warning: triangleExclamationPointIcon,
  success: circleCheckIcon,
  info: infoIcon,
};

/**
 * A message banner: `<app-alert tone="error" dismissible (dismissed)="…">{{ message }}</app-alert>`.
 *
 * Errors are `role="alert"` (announced at once); warnings, success and info are a polite
 * `role="status"`. `dismissible` adds a × button that emits `dismissed`. An action (Retry, …)
 * goes in as `<button alertAction …>` and sits at the end of the row. The host keeps the
 * `alert alert-<tone>` classes the e2e suites select on; margins come from the element
 * (`class="mb-6"`).
 */
@Component({
  selector: 'app-alert',
  imports: [Icon],
  template: `
    <app-icon [icon]="icon()" class="size-5 shrink-0" />
    <div class="flex-1 leading-normal font-medium"><ng-content /></div>
    <ng-content select="[alertAction]" />
    @if (dismissible()) {
      <button
        type="button"
        class="text-base font-bold opacity-60 hover:opacity-100 px-1"
        [attr.aria-label]="tone() === 'error' ? 'Dismiss error' : 'Dismiss'"
        (click)="dismissed.emit()"
      >
        &times;
      </button>
    }
  `,
  host: {
    '[class]': 'hostClass()',
    '[attr.role]': "tone() === 'error' ? 'alert' : 'status'",
    '[attr.aria-live]': "tone() === 'error' ? null : 'polite'",
  },
})
export class Alert {
  readonly tone = input<AlertTone>('error');
  readonly dismissible = input(false, { transform: booleanAttribute });
  readonly dismissed = output<void>();

  protected readonly icon = computed(() => ICONS[this.tone()]);
  protected readonly hostClass = computed(
    () => `alert alert-${this.tone()} tone-${TONE[this.tone()]} animate-fadeIn`,
  );
}
