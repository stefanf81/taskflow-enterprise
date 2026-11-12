import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { BarberScheduleResponse, ScheduleDay, SchedulePreviewResponse } from '../../types/api';
import { AppointmentStore } from './appointment.store';
import { BarberStore } from './barber.store';

/** One weekday row of the editor; a closed day is sent as "no shift". */
interface DayDraft {
  dayOfWeek: number;
  open: boolean;
  opens: string;
  closes: string;
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function toDraft(schedule: BarberScheduleResponse | null): DayDraft[] {
  return WEEKDAYS.map((_, index) => {
    const dayOfWeek = index + 1;
    const shift = schedule?.days.find((day) => day.dayOfWeek === dayOfWeek);
    return shift
      ? { dayOfWeek, open: true, opens: shift.opens, closes: shift.closes }
      : { dayOfWeek, open: false, opens: '09:00', closes: '17:00' };
  });
}

/**
 * Owner dashboard · the selected barber's weekly hours. A change is previewed first: the server
 * counts the upcoming bookings outside the new hours, and saving them away needs an explicit
 * confirmation. Both calls carry the schedule's revision (and the save the preview's), so a
 * schedule or booking that changed in between is refused (409) and reloaded instead of being
 * overwritten.
 */
@Component({
  selector: 'app-admin-weekly-schedule',
  template: `
    <div class="card p-5 border border-white/5 bg-zinc-900/30 rounded-2xl">
      <h4 class="text-zinc-100 font-extrabold mb-4 border-b border-white/5 pb-2">Weekly Hours</h4>

      @if (loadError()) {
        <div class="flex items-center gap-3" role="alert">
          <p class="text-xs text-rose-400 flex-1">{{ loadError() }}</p>
          <button type="button" class="btn btn-secondary py-1.5 px-3 text-xs" (click)="reload()">
            Retry
          </button>
        </div>
      } @else if (!schedule()) {
        <p class="text-xs text-zinc-500" role="status">Loading the weekly hours…</p>
      } @else {
        <div class="space-y-2">
          @for (day of draft(); track day.dayOfWeek) {
            <div class="flex flex-wrap items-center gap-3">
              <label class="flex items-center gap-2 w-32 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  [checked]="day.open"
                  [disabled]="isSaving()"
                  (change)="updateDay(day.dayOfWeek, { open: $any($event.target).checked })"
                />
                {{ weekday(day.dayOfWeek) }}
              </label>
              @if (day.open) {
                <input
                  type="time"
                  [attr.aria-label]="weekday(day.dayOfWeek) + ' opens'"
                  [value]="day.opens"
                  [disabled]="isSaving()"
                  (change)="updateDay(day.dayOfWeek, { opens: $any($event.target).value })"
                  class="form-control p-1.5 rounded-lg text-xs bg-zinc-950 border border-white/10 text-white"
                />
                <span class="text-zinc-500 text-xs">to</span>
                <input
                  type="time"
                  [attr.aria-label]="weekday(day.dayOfWeek) + ' closes'"
                  [value]="day.closes"
                  [disabled]="isSaving()"
                  (change)="updateDay(day.dayOfWeek, { closes: $any($event.target).value })"
                  class="form-control p-1.5 rounded-lg text-xs bg-zinc-950 border border-white/10 text-white"
                />
              } @else {
                <span class="text-xs text-zinc-500 italic">Not working</span>
              }
            </div>
          }
        </div>

        @if (invalidDay(); as day) {
          <p class="text-xs text-rose-400 mt-3" role="alert">
            {{ weekday(day.dayOfWeek) }} must open before it closes.
          </p>
        }

        @if (currentPreview(); as result) {
          <div class="mt-4 p-3 rounded-xl border border-white/10 bg-zinc-950/60 space-y-3">
            @if (result.conflictCount === 0) {
              <p class="text-xs text-emerald-400" role="status">
                No upcoming bookings fall outside the new hours.
              </p>
            } @else {
              <p class="text-xs text-amber-400" role="alert">
                {{ result.conflictCount }} upcoming booking(s) fall outside the new hours. Saving
                cancels them and queues an email to each customer.
              </p>
              <label class="flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  [checked]="confirmCancellation()"
                  [disabled]="isSaving()"
                  (change)="confirmCancellation.set($any($event.target).checked)"
                />
                Cancel these {{ result.conflictCount }} booking(s)
              </label>
            }
            <button
              type="button"
              class="btn btn-submit w-full py-2.5"
              [disabled]="isSaving() || (result.conflictCount > 0 && !confirmCancellation())"
              (click)="save()"
            >
              {{
                isSaving()
                  ? 'Saving…'
                  : result.conflictCount > 0
                    ? 'Save and cancel ' + result.conflictCount + ' booking(s)'
                    : 'Save weekly hours'
              }}
            </button>
          </div>
        }

        <div class="flex flex-wrap gap-2 mt-4">
          <button
            type="button"
            class="btn btn-secondary py-2 px-4 text-xs"
            [disabled]="
              isSaving() || unchanged() || invalidDay() !== null || currentPreview() !== null
            "
            (click)="review()"
          >
            Review changes
          </button>
          <button
            type="button"
            class="btn btn-secondary py-2 px-4 text-xs"
            [disabled]="isSaving() || unchanged()"
            (click)="reset()"
          >
            Discard changes
          </button>
        </div>
      }
    </div>
  `,
})
export class AdminWeeklySchedule {
  private readonly barberStore = inject(BarberStore);
  private readonly appointmentStore = inject(AppointmentStore);

  protected readonly schedule = this.barberStore.schedule;
  protected readonly loadError = this.barberStore.scheduleError;
  protected readonly isSaving = this.barberStore.isSaving;

  /** The edited week; starts again from the server's whenever another barber or revision loads. */
  protected readonly draft = linkedSignal<DayDraft[]>(() => toDraft(this.schedule()));
  private readonly preview = signal<{
    key: string;
    barberId: number;
    result: SchedulePreviewResponse;
  } | null>(null);
  protected readonly confirmCancellation = signal(false);

  private readonly days = computed<ScheduleDay[]>(() =>
    this.draft()
      .filter((day) => day.open)
      .map(({ dayOfWeek, opens, closes }) => ({ dayOfWeek, opens, closes })),
  );
  private readonly draftKey = computed(() => JSON.stringify(this.days()));

  protected readonly invalidDay = computed(
    () => this.draft().find((day) => day.open && !(day.opens < day.closes)) ?? null,
  );
  protected readonly unchanged = computed(() => {
    const schedule = this.schedule();
    return !!schedule && JSON.stringify(schedule.days) === this.draftKey();
  });
  /** The preview of exactly this draft for this barber; any edit makes it stale. */
  protected readonly currentPreview = computed(() => {
    const preview = this.preview();
    return preview &&
      preview.key === this.draftKey() &&
      preview.barberId === this.barberStore.selectedBarberId()
      ? preview.result
      : null;
  });

  protected weekday(dayOfWeek: number): string {
    return WEEKDAYS[dayOfWeek - 1] ?? '';
  }

  protected updateDay(dayOfWeek: number, patch: Partial<DayDraft>): void {
    this.draft.update((days) =>
      days.map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day)),
    );
    this.confirmCancellation.set(false);
  }

  protected async review(): Promise<void> {
    const barberId = this.barberStore.selectedBarberId();
    const schedule = this.schedule();
    if (!barberId || !schedule || this.invalidDay()) return;
    const key = this.draftKey();
    this.barberStore.actionSuccessMessage.set(null);
    const result = await this.barberStore.previewSchedule(barberId, {
      days: this.days(),
      expectedRevision: schedule.revision,
      cancelConflictingAppointments: false,
    });
    // The owner may have picked another barber while the preview was on its way.
    if (result && this.barberStore.selectedBarberId() === barberId) {
      this.preview.set({ key, barberId, result });
      this.confirmCancellation.set(false);
    }
  }

  protected async save(): Promise<void> {
    const preview = this.currentPreview();
    const barberId = this.barberStore.selectedBarberId();
    const schedule = this.schedule();
    if (!preview || !barberId || !schedule) return;
    if (preview.conflictCount > 0 && !this.confirmCancellation()) return;
    const saved = await this.barberStore.updateSchedule(barberId, {
      days: this.days(),
      expectedRevision: schedule.revision,
      expectedConflicts: preview.conflictsRevision,
      cancelConflictingAppointments: preview.conflictCount > 0,
    });
    this.preview.set(null);
    this.confirmCancellation.set(false);
    // Cancelled bookings leave the owner's appointment list.
    if (saved && preview.conflictCount > 0) this.appointmentStore.refresh();
  }

  protected reset(): void {
    this.draft.set(toDraft(this.schedule()));
    this.preview.set(null);
    this.confirmCancellation.set(false);
  }

  protected reload(): void {
    this.barberStore.loadSchedule();
  }
}
