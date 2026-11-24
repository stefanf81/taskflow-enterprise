import { Component, input } from '@angular/core';

/**
 * A Lucide icon: `<app-icon [icon]="calendarIcon" class="size-4" />`, with the path imported from
 * its own module (`import { calendarIcon } from '…/core/ui/icons/calendar'`).
 *
 * The icons in `core/ui/icons/` come from Lucide (https://lucide.dev, ISC License, copyright 2026
 * Lucide Icons and Contributors), lucide-static@1.75.0's icon-nodes.json, with each icon's shapes
 * merged into one path (Lucide icons are stroke-only, so it renders the same). One module per icon
 * and no barrel file: esbuild puts a module in exactly one chunk, so a shared icon file (or a
 * barrel re-exporting them) ended up whole in main.js as soon as the landing page used one icon.
 * To add an icon, copy a file there and fill in the merged path.
 *
 * Decorative: hidden from assistive technology, so the text next to it (or the control's
 * aria-label) carries the meaning. Sized 1em by default, so it scales with the surrounding text
 * like the emoji it replaced; a size utility on the element overrides that (`.app-icon` sits in
 * `@layer components`). Colour is `currentColor`.
 */
@Component({
  selector: 'app-icon',
  template: `<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    focusable="false"
  >
    <path [attr.d]="icon()" />
  </svg>`,
  host: { class: 'app-icon', 'aria-hidden': 'true' },
})
export class Icon {
  /** A path constant from `core/ui/icons/<name>.ts`. */
  readonly icon = input.required<string>();
}
