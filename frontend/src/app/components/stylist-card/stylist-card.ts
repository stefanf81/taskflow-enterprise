import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface StylistProfile {
  name: string;
  title: string;
  rating: string;
  reviews: string;
  specialty: string;
}

@Component({
  selector: 'app-stylist-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="card p-4 border border-white/5 bg-zinc-900/30 hover:border-indigo-500/30 hover:bg-indigo-500/5 flex items-center gap-4 cursor-pointer transition-all"
      [class.selected-service-item]="isSelected()"
      (click)="selected.emit()"
    >
      <!-- Initial Avatar Circle -->
      <div
        class="w-12 h-12 rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600 flex items-center justify-center text-sm font-black text-white"
      >
        {{ profile().name.charAt(0) }}
      </div>
      <div class="flex-1 min-width-0">
        <div class="flex justify-between items-center">
          <h3 class="m-0 text-zinc-100 font-extrabold text-sm">{{ profile().name }}</h3>
          <span class="text-xs font-bold text-indigo-400"
            >{{ profile().rating }}
            <span class="text-[10px] text-zinc-500 font-light"
              >({{ profile().reviews }})</span
            ></span
          >
        </div>
        <p class="m-0 text-[11px] font-semibold text-indigo-400 mt-0.5">
          {{ profile().title }}
        </p>
        <p class="m-0 text-xs text-zinc-500 font-light mt-1 leading-normal">
          {{ profile().specialty }}
        </p>
      </div>
    </div>
  `
})
export class StylistCard {
  // Use Angular 22 Signal-based inputs & outputs
  readonly profile = input.required<StylistProfile>();
  readonly isSelected = input<boolean>(false);
  readonly selected = output<void>();
}
