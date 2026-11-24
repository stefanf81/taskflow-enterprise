import { Component, input, output } from '@angular/core';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A row of mutually exclusive toggle buttons (a filter or category picker):
 *
 * `<app-segmented-control label="Filter by status" [options]="filters" [value]="filter()" (valueChange)="setFilter($event)" />`
 *
 * Each option is a `<button aria-pressed>` inside a labelled `role="group"`, so screen readers
 * announce which one is on. For switching between panels use tabs instead.
 */
@Component({
  selector: 'app-segmented-control',
  template: `
    @for (option of options(); track option.value) {
      <button
        type="button"
        [attr.aria-pressed]="value() === option.value"
        [class.bg-zinc-950]="value() === option.value"
        [class.text-accent]="value() === option.value"
        class="flex-1 text-center py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-200 text-zinc-400 hover:text-zinc-100"
        (click)="valueChange.emit(option.value)"
      >
        {{ option.label }}
      </button>
    }
  `,
  host: {
    role: 'group',
    '[attr.aria-label]': 'label()',
    class: 'flex bg-white/5 rounded-xl p-1 border border-white/5',
  },
})
export class SegmentedControl<T extends string = string> {
  readonly options = input.required<readonly SegmentOption<T>[]>();
  readonly value = input.required<T>();
  /** Accessible name of the group ("Treatment category", "Filter by status"). */
  readonly label = input.required<string>();
  readonly valueChange = output<T>();
}
