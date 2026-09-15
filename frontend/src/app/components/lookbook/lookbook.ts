import { Component, output, ChangeDetectionStrategy } from '@angular/core';

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
        <button
          type="button"
          (click)="selectStyle('Classic Haircut', 'hair')"
          class="group w-full p-6 rounded-2xl border border-white/5 bg-zinc-900/50 hover:bg-gold/10 hover:border-gold/30 hover:shadow-[0_0_15px_rgba(197,160,89,0.2)] cursor-pointer text-center transition-all duration-300"
        >
          <span class="text-3xl block mb-3">👦🏻</span>
          <span
            class="block font-extrabold text-sm text-zinc-100 mb-1 group-hover:text-gold transition-colors"
          >
            Executive Pompadour
          </span>
          <span
            class="inline-block bg-white/10 text-zinc-400 text-[9px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider mb-3"
            >Classic Crop</span
          >
          <span class="block text-xs text-zinc-500 font-light leading-relaxed">
            Tailored scissor cut with razor-sharp contours and structural clay molding.
          </span>
        </button>

        <!-- Style 2 -->
        <button
          type="button"
          (click)="selectStyle('Modern Skin Fade', 'hair')"
          class="group w-full p-6 rounded-2xl border border-white/5 bg-zinc-900/50 hover:bg-gold/10 hover:border-gold/30 hover:shadow-[0_0_15px_rgba(197,160,89,0.2)] cursor-pointer text-center transition-all duration-300"
        >
          <span class="text-3xl block mb-3">👱🏽‍♂️</span>
          <span
            class="block font-extrabold text-sm text-zinc-100 mb-1 group-hover:text-gold transition-colors"
          >
            Midnight Skin Fade
          </span>
          <span
            class="inline-block bg-white/10 text-zinc-400 text-[9px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider mb-3"
            >Textured Crop</span
          >
          <span class="block text-xs text-zinc-500 font-light leading-relaxed">
            Zero-blended razor taper fade with deep textured fringes and extreme clay volume.
          </span>
        </button>

        <!-- Style 3 -->
        <button
          type="button"
          (click)="selectStyle('Beard Trim & Shave', 'beard')"
          class="group w-full p-6 rounded-2xl border border-white/5 bg-zinc-900/50 hover:bg-gold/10 hover:border-gold/30 hover:shadow-[0_0_15px_rgba(197,160,89,0.2)] cursor-pointer text-center transition-all duration-300"
        >
          <span class="text-3xl block mb-3">🧔🏾</span>
          <span
            class="block font-extrabold text-sm text-zinc-100 mb-1 group-hover:text-gold transition-colors"
          >
            Bespoke Beard Sculpt
          </span>
          <span
            class="inline-block bg-white/10 text-zinc-400 text-[9px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider mb-3"
            >Beard Design</span
          >
          <span class="block text-xs text-zinc-500 font-light leading-relaxed">
            Custom jawline alignment, trimmer blending, oil massage, and hot towel shave.
          </span>
        </button>

        <!-- Style 4 -->
        <button
          type="button"
          (click)="selectStyle('The Executive Package', 'combo')"
          class="group w-full p-6 rounded-2xl border border-white/5 bg-zinc-900/50 hover:bg-gold/10 hover:border-gold/30 hover:shadow-[0_0_15px_rgba(197,160,89,0.2)] cursor-pointer text-center transition-all duration-300"
        >
          <span class="text-3xl block mb-3">🤵🏼</span>
          <span
            class="block font-extrabold text-sm text-zinc-100 mb-1 group-hover:text-gold transition-colors"
          >
            Royal Executive
          </span>
          <span
            class="inline-block bg-white/10 text-zinc-400 text-[9px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider mb-3"
            >Combo Elite</span
          >
          <span class="block text-xs text-zinc-500 font-light leading-relaxed">
            Signature cut, beard sculpting, steam towels, essential oil head rub, and mask.
          </span>
        </button>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LookbookComponent {
  /** Emitted when a user clicks a lookbook style card. */
  readonly styleSelected = output<{ serviceName: string; category: string }>();

  selectStyle(serviceName: string, category: string): void {
    this.styleSelected.emit({ serviceName, category });
  }
}
