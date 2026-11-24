import { Component, input } from '@angular/core';
import { Icon } from './icon';

/**
 * The top of a signed-in page: icon, title (the page's `<h1>`), subtitle and actions on the right.
 *
 * `<app-page-header [icon]="calendarIcon" title="My Appointments" subtitle="…">
 *    <a routerLink="/customer/book" appButton>Book an appointment</a>
 *  </app-page-header>`
 *
 * No entrance animation: the heading is the signed-in pages' LCP element (BENCHMARKS.md §73,
 * `e2e/landing-stability.spec.ts`).
 */
@Component({
  selector: 'app-page-header',
  imports: [Icon],
  template: `
    <div class="flex items-center gap-3 min-w-0">
      <app-icon [icon]="icon()" class="size-7 shrink-0 text-accent" />
      <div class="min-w-0">
        <h1 class="text-xl font-extrabold text-white uppercase leading-none">{{ title() }}</h1>
        @if (subtitle()) {
          <p class="text-xs text-zinc-500 mt-1.5 font-light">{{ subtitle() }}</p>
        }
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-3"><ng-content /></div>
  `,
  host: {
    class: 'flex flex-wrap justify-between items-center gap-4 mb-10 pb-6 border-b border-white/10',
    role: 'banner',
  },
})
export class PageHeader {
  readonly icon = input.required<string>();
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
}
