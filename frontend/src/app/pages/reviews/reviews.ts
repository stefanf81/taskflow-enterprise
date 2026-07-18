import { Component, ChangeDetectionStrategy } from '@angular/core';
import { ReviewPortal } from './review-portal';

/** Route wrapper for the review submission portal. */
@Component({
  selector: 'app-reviews',
  standalone: true,
  imports: [ReviewPortal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-full px-4 sm:px-8 lg:px-16 pt-12">
      <app-review-portal />
    </div>
  `,
})
export class Reviews {}
