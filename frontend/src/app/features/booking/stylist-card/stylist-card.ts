import { Component, input, output } from '@angular/core';

export interface StylistProfile {
  name: string;
  title: string;
  rating: string;
  reviews: string;
  specialty: string;
  badge?: string;
}

@Component({
  selector: 'app-stylist-card',
  imports: [],
  template: `
    <button
      type="button"
      [attr.aria-pressed]="isSelected()"
      class="card w-full text-left p-4 flex items-center gap-4 cursor-pointer"
      [class.selected-service-item]="isSelected()"
      (click)="selected.emit()"
    >
      <!-- Initial Avatar Circle (decorative: the name below says it). The button's accessible
           name comes from its visible text; an aria-label that omits the title and specialty
           fails WCAG 2.5.3 (axe label-content-name-mismatch). -->
      <span
        aria-hidden="true"
        class="w-12 h-12 rounded-full bg-gradient-to-r from-accent to-accent-muted flex items-center justify-center text-sm font-black text-black"
      >
        {{ profile().name.charAt(0) }}
      </span>
      <span class="flex-1 block min-width-0">
        <span class="flex justify-between items-center">
          <span class="flex items-center gap-2">
            <span class="m-0 text-zinc-100 font-extrabold text-sm">{{ profile().name }}</span>
            @if (profile().badge) {
              <span
                class="text-xs uppercase font-black tracking-wider px-1.5 py-0.5 rounded bg-accent/20 text-accent border border-accent/30"
              >
                {{ profile().badge }}
              </span>
            }
          </span>
          <span class="text-xs font-bold text-accent"
            >{{ profile().rating }}
            <span class="text-xs text-zinc-500 font-light">({{ profile().reviews }})</span></span
          >
        </span>
        <span class="block m-0 text-xs font-semibold text-accent mt-0.5">
          {{ profile().title }}
        </span>
        <span class="block m-0 text-xs text-zinc-500 font-light mt-1 leading-normal">
          {{ profile().specialty }}
        </span>
      </span>
    </button>
  `,
})
export class StylistCard {
  // Use Angular 22 Signal-based inputs & outputs
  readonly profile = input.required<StylistProfile>();
  readonly isSelected = input<boolean>(false);
  readonly selected = output<void>();
}
