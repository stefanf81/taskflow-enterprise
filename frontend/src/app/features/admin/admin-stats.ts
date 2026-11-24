import { Component, computed, inject } from '@angular/core';
import { formatUsd } from '../../core/format';
import { Icon } from '../../core/ui/icon';
import { checkIcon } from '../../core/ui/icons/check';
import { clipboardListIcon } from '../../core/ui/icons/clipboard-list';
import { dollarSignIcon } from '../../core/ui/icons/dollar-sign';
import { hourglassIcon } from '../../core/ui/icons/hourglass';
import { triangleExclamationPointIcon } from '../../core/ui/icons/triangle-exclamation-point';
import { AppointmentStore } from './appointment.store';

/**
 * The booking numbers (total, pending, approved, overdue, revenue) and the approval progress bar.
 * Shown at the top of the appointments section only: they describe bookings, not the catalog or
 * the schedules. A failed load shows nothing here (the list below carries the error and its
 * retry) instead of a board of misleading zeros.
 */
@Component({
  selector: 'app-admin-stats',
  imports: [Icon],
  template: `
    @if (!loadFailed()) {
      <!-- STATS BOARD GRID (SAAS CLEAN TILES) -->
      <section class="grid grid-cols-2 xl:grid-cols-5 gap-4 mb-6 text-zinc-100">
        <!-- Tile 1 -->
        <div class="card p-5 flex justify-between items-center">
          <div class="flex flex-col">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
              >Total Bookings</span
            >
            <span class="text-2xl font-black text-white mt-1 leading-none">{{
              stats().total
            }}</span>
          </div>
          <div
            class="w-10 h-10 rounded-xl xl:max-2xl:hidden bg-white/5 text-zinc-400 flex items-center justify-center font-bold"
          >
            <app-icon [icon]="icons.clipboardList" class="size-5" />
          </div>
        </div>

        <!-- Tile 2 -->
        <div class="card p-5 flex justify-between items-center">
          <div class="flex flex-col">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
              >Pending Approval</span
            >
            <span class="text-2xl font-black text-amber-400 mt-1 leading-none">{{
              stats().pending
            }}</span>
          </div>
          <div
            class="w-10 h-10 rounded-xl xl:max-2xl:hidden bg-amber-500/10 text-amber-400 flex items-center justify-center font-bold"
          >
            <app-icon [icon]="icons.hourglass" class="size-5" />
          </div>
        </div>

        <!-- Tile 3 -->
        <div class="card p-5 flex justify-between items-center">
          <div class="flex flex-col">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
              >Approved Slots</span
            >
            <span class="text-2xl font-black text-emerald-500 mt-1 leading-none">{{
              stats().approved
            }}</span>
          </div>
          <div
            class="w-10 h-10 rounded-xl xl:max-2xl:hidden bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-bold"
          >
            <app-icon [icon]="icons.check" class="size-5" />
          </div>
        </div>

        <!-- Tile 4 -->
        <div class="card p-5 flex justify-between items-center">
          <div class="flex flex-col">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
              >Overdue Pending</span
            >
            <span class="text-2xl font-black text-rose-500 mt-1 leading-none">{{
              stats().overdue
            }}</span>
          </div>
          <div
            class="w-10 h-10 rounded-xl xl:max-2xl:hidden bg-rose-500/10 text-rose-500 flex items-center justify-center font-bold"
          >
            <app-icon [icon]="icons.triangleExclamationPoint" class="size-5" />
          </div>
        </div>

        <!-- Tile 5 -->
        <div class="card p-5 flex justify-between items-center col-span-2 xl:col-span-1">
          <div class="flex flex-col">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
              >Estimated Revenue</span
            >
            <span class="text-2xl font-black text-accent mt-1 leading-none">{{
              approvedRevenue()
            }}</span>
          </div>
          <div
            class="w-10 h-10 rounded-xl xl:max-2xl:hidden bg-accent/10 text-accent flex items-center justify-center font-extrabold"
          >
            <app-icon [icon]="icons.dollarSign" class="size-5" />
          </div>
        </div>
      </section>

      <!-- APPROVAL PROGRESS RATE BAR -->
      <div class="card p-5 mb-6">
        <div
          class="flex justify-between items-center text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2"
        >
          <span>Slot Approval Completion Rate</span>
          <span class="text-accent font-extrabold text-sm">{{ stats().progress }}%</span>
        </div>
        <div
          role="progressbar"
          aria-label="Slot approval completion rate"
          aria-valuemin="0"
          aria-valuemax="100"
          [attr.aria-valuenow]="stats().progress"
          class="w-full h-2 bg-white/5 rounded-full overflow-hidden"
        >
          <div
            class="h-full bg-gradient-to-r from-accent to-accent-muted rounded-full"
            [style.width.%]="stats().progress"
          ></div>
        </div>
      </div>
    }
  `,
})
export class AdminStats {
  protected readonly icons = {
    check: checkIcon,
    clipboardList: clipboardListIcon,
    dollarSign: dollarSignIcon,
    hourglass: hourglassIcon,
    triangleExclamationPoint: triangleExclamationPointIcon,
  };
  private readonly store = inject(AppointmentStore);

  protected readonly stats = this.store.stats;
  protected readonly approvedRevenue = computed(() => formatUsd(this.stats().approvedRevenue));
  protected readonly loadFailed = computed(() => this.store.loadErrorMessage() !== null);
}
