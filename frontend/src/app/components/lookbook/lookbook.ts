import { Component, output, ChangeDetectionStrategy, ViewEncapsulation } from '@angular/core';

/**
 * Standalone Lookbook Showcase component.
 *
 * Displays signature style cards that users can click to auto-select
 * a treatment package. This component is designed for @defer lazy-loading
 * since it sits below the hero section and is non-critical for FCP.
 */
@Component({
  selector: 'app-lookbook',
  standalone: true,
  imports: [],
  template: `
    <section class="card bg-zinc-950 border border-white/10 rounded-3xl p-8 mb-16">
      <h2 class="text-center text-lg font-extrabold text-zinc-100 uppercase tracking-wider mb-2">
        ✂️ Signature Lookbook
      </h2>
      <p class="text-center text-xs text-zinc-500 font-light max-w-md mx-auto mb-8">
        Browse our trending style collections. Click any look below to automatically load the
        treatment package directly into your guided assistant wizard!
      </p>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <!-- Style 1 -->
        <div
          tabindex="0"
          role="button"
          (click)="selectStyle('Classic Haircut', 'hair')"
          (keydown.enter)="selectStyle('Classic Haircut', 'hair')"
          (keydown.space)="selectStyle('Classic Haircut', 'hair'); $event.preventDefault()"
          class="group p-6 rounded-2xl border border-white/5 bg-zinc-900/50 hover:bg-gold/10 hover:border-gold/30 hover:shadow-[0_0_15px_rgba(197,160,89,0.2)] cursor-pointer text-center transition-all duration-300"
        >
          <span class="text-3xl block mb-3">👦🏻</span>
          <h4
            class="font-extrabold text-sm text-zinc-100 mb-1 group-hover:text-gold transition-colors"
          >
            Executive Pompadour
          </h4>
          <span
            class="inline-block bg-white/10 text-zinc-400 text-[9px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider mb-3"
            >Classic Crop</span
          >
          <p class="text-xs text-zinc-500 font-light leading-relaxed">
            Tailored scissor cut with razor-sharp contours and structural clay molding.
          </p>
        </div>

        <!-- Style 2 -->
        <div
          tabindex="0"
          role="button"
          (click)="selectStyle('Modern Skin Fade', 'hair')"
          (keydown.enter)="selectStyle('Modern Skin Fade', 'hair')"
          (keydown.space)="selectStyle('Modern Skin Fade', 'hair'); $event.preventDefault()"
          class="group p-6 rounded-2xl border border-white/5 bg-zinc-900/50 hover:bg-gold/10 hover:border-gold/30 hover:shadow-[0_0_15px_rgba(197,160,89,0.2)] cursor-pointer text-center transition-all duration-300"
        >
          <span class="text-3xl block mb-3">👱🏽‍♂️</span>
          <h4
            class="font-extrabold text-sm text-zinc-100 mb-1 group-hover:text-gold transition-colors"
          >
            Midnight Skin Fade
          </h4>
          <span
            class="inline-block bg-white/10 text-zinc-400 text-[9px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider mb-3"
            >Textured Crop</span
          >
          <p class="text-xs text-zinc-500 font-light leading-relaxed">
            Zero-blended razor taper fade with deep textured fringes and extreme clay volume.
          </p>
        </div>

        <!-- Style 3 -->
        <div
          tabindex="0"
          role="button"
          (click)="selectStyle('Beard Trim & Shave', 'beard')"
          (keydown.enter)="selectStyle('Beard Trim & Shave', 'beard')"
          (keydown.space)="selectStyle('Beard Trim & Shave', 'beard'); $event.preventDefault()"
          class="group p-6 rounded-2xl border border-white/5 bg-zinc-900/50 hover:bg-gold/10 hover:border-gold/30 hover:shadow-[0_0_15px_rgba(197,160,89,0.2)] cursor-pointer text-center transition-all duration-300"
        >
          <span class="text-3xl block mb-3">🧔🏾</span>
          <h4
            class="font-extrabold text-sm text-zinc-100 mb-1 group-hover:text-gold transition-colors"
          >
            Bespoke Beard Sculpt
          </h4>
          <span
            class="inline-block bg-white/10 text-zinc-400 text-[9px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider mb-3"
            >Beard Design</span
          >
          <p class="text-xs text-zinc-500 font-light leading-relaxed">
            Custom jawline alignment, trimmer blending, oil massage, and hot towel shave.
          </p>
        </div>

        <!-- Style 4 -->
        <div
          tabindex="0"
          role="button"
          (click)="selectStyle('The Executive Package', 'combo')"
          (keydown.enter)="selectStyle('The Executive Package', 'combo')"
          (keydown.space)="selectStyle('The Executive Package', 'combo'); $event.preventDefault()"
          class="group p-6 rounded-2xl border border-white/5 bg-zinc-900/50 hover:bg-gold/10 hover:border-gold/30 hover:shadow-[0_0_15px_rgba(197,160,89,0.2)] cursor-pointer text-center transition-all duration-300"
        >
          <span class="text-3xl block mb-3">🤵🏼</span>
          <h4
            class="font-extrabold text-sm text-zinc-100 mb-1 group-hover:text-gold transition-colors"
          >
            Royal Executive
          </h4>
          <span
            class="inline-block bg-white/10 text-zinc-400 text-[9px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider mb-3"
            >Combo Elite</span
          >
          <p class="text-xs text-zinc-500 font-light leading-relaxed">
            Signature cut, beard sculpting, steam towels, essential oil head rub, and mask.
          </p>
        </div>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class LookbookComponent {
  /** Emitted when a user clicks a lookbook style card. */
  readonly styleSelected = output<{ serviceName: string; category: string }>();

  selectStyle(serviceName: string, category: string): void {
    this.styleSelected.emit({ serviceName, category });
  }
}
