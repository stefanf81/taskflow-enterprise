import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { StatusBadge, statusLabel } from './status-badge';

@Component({
  imports: [StatusBadge],
  template: `<app-status-badge [status]="status()" [overdue]="overdue()" />`,
})
class Host {
  readonly status = signal('PENDING');
  readonly overdue = signal(false);
}

describe('statusLabel', () => {
  it('title-cases known and unknown statuses', () => {
    expect(statusLabel('PENDING')).toBe('Pending');
    expect(statusLabel('CANCELLED')).toBe('Cancelled');
    expect(statusLabel('NO_SHOW')).toBe('No_show');
    expect(statusLabel('')).toBe('');
  });
});

describe('StatusBadge', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const badge = (fixture.nativeElement as HTMLElement).querySelector('app-status-badge')!;
    const set = (status: string, overdue = false) => {
      fixture.componentInstance.status.set(status);
      fixture.componentInstance.overdue.set(overdue);
      fixture.detectChanges();
    };
    return { badge, set };
  }

  it.each([
    ['APPROVED', 'Approved', 'tone-success'],
    ['SENT', 'Sent', 'tone-success'],
    ['PENDING', 'Pending', 'tone-warning'],
    ['DENIED', 'Denied', 'tone-danger'],
    ['FAILED', 'Failed', 'tone-danger'],
    ['CANCELLED', 'Cancelled', 'tone-neutral'],
    ['SOMETHING_NEW', 'Something_new', 'tone-neutral'],
  ])('shows %s as "%s" (%s)', (status, label, tone) => {
    const { badge, set } = render();
    set(status);
    expect(badge.textContent?.trim()).toBe(label);
    expect([...badge.classList]).toEqual(['status-badge', tone]);
  });

  it('turns an overdue pending booking into a solid "Overdue" badge, and only a pending one', () => {
    const { badge, set } = render();
    set('PENDING', true);
    expect(badge.textContent?.trim()).toBe('Overdue');
    expect([...badge.classList]).toEqual(['status-badge', 'alarm']);

    set('APPROVED', true);
    expect(badge.textContent?.trim()).toBe('Approved');
  });
});
