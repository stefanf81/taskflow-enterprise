import { Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { Button } from '../../../core/ui/button';

/** The element the bar jumps to and watches: the landing page's booking section. */
export const BOOKING_SECTION_ID = 'booking';

/**
 * A "Book an appointment" bar fixed to the bottom of a phone screen. The wizard starts well below
 * the hero, so without it a visitor has to scroll to find the way to book.
 *
 * - A plain `<a href="#booking">`: it works in the prerendered page before any script ran (smooth
 *   scrolling comes from the global `scroll-behavior`, switched off for reduced motion).
 * - `lg:hidden`: a desktop shows the wizard beside the hero.
 * - Hidden while the booking section is on screen (an IntersectionObserver, browser only), so it
 *   never covers the step buttons it leads to.
 * - Fixed, so it takes no room in the layout and cannot shift it; the page container keeps 6 rem
 *   of bottom padding for it.
 */
@Component({
  selector: 'app-book-bar',
  imports: [Button],
  template: `
    <div
      class="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden"
      [class.hidden]="bookingInView()"
    >
      <a [href]="'#' + sectionId" appButton class="w-full">Book an appointment</a>
    </div>
  `,
})
export class BookBar {
  protected readonly sectionId = BOOKING_SECTION_ID;
  protected readonly bookingInView = signal(false);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const section = document.getElementById(BOOKING_SECTION_ID);
      if (!section || typeof IntersectionObserver === 'undefined') return;
      const observer = new IntersectionObserver(([entry]) => {
        if (entry) this.bookingInView.set(entry.isIntersecting);
      });
      observer.observe(section);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
