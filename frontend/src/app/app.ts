import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { AuthStore } from './auth.store';

/**
 * Application shell: owns the global layout, top navigation and the router
 * outlet. All feature areas (landing, booking, admin, etc.) are lazy-loaded
 * route components so feature code never enters the initial bundle. The shell
 * only depends on AuthStore for the minimal logged-in flag it needs to toggle
 * guest chrome — it never injects feature stores.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterLink, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!auth.isLoggedIn()) {
      <!-- PREMIUM SAAS ANNOUNCEMENT BAR -->
      <div
        class="w-full bg-zinc-900 border-b border-slate-800 py-2.5 px-4 text-center text-[11px] font-semibold text-indigo-400 tracking-wider uppercase animate-fade-in flex items-center justify-center gap-2"
      >
        <span class="inline-flex h-2 w-2 rounded-full bg-indigo-400 animate-ping"></span>
        <span
          >Special Highlight: Book 'The Executive Package' today and get 15% off any premium hair
          styling clay!</span
        >
      </div>
    }

    <div class="min-h-screen bg-faint-barber text-zinc-100 font-sans antialiased pb-24">
      @if (!auth.isLoggedIn()) {
        <!-- Sticky Navigation Header -->
        <nav
          class="flex justify-between items-center w-full px-4 sm:px-8 lg:px-16 pt-12 mb-16 py-4 border-b border-white/10"
        >
          <a routerLink="/" class="flex items-center gap-2.5">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="2.5"
              stroke="currentColor"
              class="w-7 h-7 text-indigo-400"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span class="text-xl font-extrabold tracking-tight text-zinc-100 uppercase"
              >TaskFlow
              <span class="text-indigo-400 font-light lowercase text-base">pro</span></span
            >
          </a>
          <div class="flex items-center gap-4">
            <span
              class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
            >
              ● Shop Open
            </span>
            <a
              routerLink="/booking"
              class="text-xs font-bold text-zinc-400 hover:text-indigo-400 tracking-wide uppercase transition-colors"
              >Book Now</a
            >
            <a
              routerLink="/login"
              class="text-xs font-bold text-zinc-400 hover:text-indigo-400 tracking-wide uppercase transition-colors"
              >Owner Portal</a
            >
          </div>
        </nav>
      }

      <router-outlet />
    </div>
  `,
})
export class App {
  protected readonly auth = inject(AuthStore);
}
