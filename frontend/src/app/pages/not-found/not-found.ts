import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Dedicated 404 route component, rendered within the application shell. */
@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="w-full px-4 sm:px-8 lg:px-16 pt-24 pb-12 text-center flex flex-col items-center gap-6"
    >
      <span class="text-6xl font-black tracking-tight text-indigo-400">404</span>
      <h1 class="text-2xl font-extrabold uppercase tracking-tight text-zinc-100">Page Not Found</h1>
      <p class="text-sm text-zinc-400 font-light max-w-md">
        The page you are looking for does not exist or may have been moved.
      </p>
      <a routerLink="/" class="btn btn-submit py-3 px-8 text-sm font-bold uppercase"
        >Back to Home</a
      >
    </div>
  `,
})
export class NotFound {}
