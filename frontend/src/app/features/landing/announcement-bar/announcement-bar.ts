import { Component, computed, inject } from '@angular/core';
import { ShopClock } from '../../../core/shop-clock';

/**
 * The promo strip at the top of the landing page, set by the owner (`announcement` in
 * `GET /api/v1/appointments/public/shop`, which the page loads anyway).
 *
 * The page is prerendered without a backend, so the text arrives after first paint. The strip
 * therefore holds its room from the start, exactly the height of the 120 characters the backend
 * allows: three lines on a phone, two from `sm`, one from `lg` (the seeded text fills the same
 * lines, so nothing moves). Its text stays `invisible` until known, like the open/closed badge.
 * It collapses once the shop info has said the owner turned the strip off, and when the shop info
 * could not be loaded: an invisible strip would otherwise stay above the hero for the whole visit.
 */
@Component({
  selector: 'app-announcement-bar',
  template: `
    @if (!hidden()) {
      <div
        class="w-full h-[69px] sm:h-[53px] lg:h-[37px] bg-zinc-900 border-b border-slate-800 px-4 text-center text-xs font-semibold text-accent tracking-wider uppercase flex items-center justify-center gap-2"
        [class.invisible]="!shop.loaded()"
      >
        <span
          aria-hidden="true"
          class="inline-flex shrink-0 h-2 w-2 rounded-full bg-accent animate-ping"
        ></span>
        <span class="max-h-full overflow-hidden">{{ shop.announcement() }}</span>
      </div>
    }
  `,
})
export class AnnouncementBarComponent {
  protected readonly shop = inject(ShopClock);
  /** Collapsed once the server has said there is no strip, or could not say anything. */
  protected readonly hidden = computed(
    () => this.shop.loadFailed() || (this.shop.loaded() && !this.shop.announcement()),
  );
}
