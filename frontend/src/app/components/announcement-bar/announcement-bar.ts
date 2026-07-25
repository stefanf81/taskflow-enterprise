import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-announcement-bar',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="w-full bg-zinc-900 border-b border-slate-800 py-2.5 px-4 text-center text-[11px] font-semibold text-gold tracking-wider uppercase animate-fade-in flex items-center justify-center gap-2"
    >
      <span class="inline-flex h-2 w-2 rounded-full bg-gold animate-ping"></span>
      <span
        >Special Highlight: Book 'The Executive Package' today and get 15% off any premium hair
        styling clay!</span
      >
    </div>
  `,
})
export class AnnouncementBarComponent {}
