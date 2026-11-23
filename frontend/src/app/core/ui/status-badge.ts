import { Component, computed, input } from '@angular/core';

type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral';

/**
 * Tone of each status the backend reports: appointment statuses (PENDING, APPROVED, DENIED,
 * CANCELLED) and notification outbox statuses (PENDING, SENT, FAILED). An unknown status is
 * neutral, so a state added server-side later still renders.
 */
const TONES: Record<string, BadgeTone> = {
  APPROVED: 'success',
  SENT: 'success',
  PENDING: 'warning',
  DENIED: 'danger',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

/** Human label for a status ("CANCELLED" -> "Cancelled"); unknown values are title-cased. */
export function statusLabel(status: string): string {
  if (!status) return '';
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

/**
 * A status pill: `<app-status-badge [status]="appt.status" />`. `overdue` turns a pending
 * appointment into a solid red "Overdue" badge (the owner has not answered in time).
 */
@Component({
  selector: 'app-status-badge',
  template: `{{ label() }}`,
  host: {
    '[class]': 'hostClass()',
  },
})
export class StatusBadge {
  readonly status = input.required<string>();
  readonly overdue = input(false);

  private readonly isOverdue = computed(() => this.overdue() && this.status() === 'PENDING');
  protected readonly label = computed(() =>
    this.isOverdue() ? 'Overdue' : statusLabel(this.status()),
  );
  protected readonly hostClass = computed(() =>
    this.isOverdue()
      ? 'status-badge alarm'
      : `status-badge tone-${TONES[this.status()] ?? 'neutral'}`,
  );
}
