import { Directive, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'btn btn-submit',
  secondary: 'btn btn-secondary',
  danger: 'btn btn-danger',
};

/**
 * The app's button styles on a native `<button>` or `<a>` (it keeps its own semantics, focus and
 * keyboard behaviour): `<button type="button" appButton="secondary">Retry</button>`.
 *
 * - `primary` (default): gold fill, for the one main action of a view.
 * - `secondary`: outlined, for everything else.
 * - `danger`: red tint, for cancelling, denying and signing out.
 *
 * Spacing and width come from utilities on the element (`class="w-full mt-4"`), which beat the
 * `.btn*` component classes.
 */
@Directive({
  selector: 'button[appButton], a[appButton]',
  host: { '[class]': 'variantClass()' },
})
export class Button {
  /** `appButton` alone (empty string) means `primary`. */
  readonly appButton = input<ButtonVariant | ''>('');

  protected variantClass(): string {
    return VARIANT_CLASSES[this.appButton() || 'primary'];
  }
}
