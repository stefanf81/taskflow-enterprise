import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { SegmentedControl, SegmentOption } from './segmented-control';

@Component({
  imports: [SegmentedControl],
  template: `
    <app-segmented-control
      label="Filter by status"
      [options]="options"
      [value]="value()"
      (valueChange)="value.set($event)"
    />
  `,
})
class Host {
  readonly options: SegmentOption<string>[] = [
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Pending' },
  ];
  readonly value = signal('all');
}

describe('SegmentedControl', () => {
  it('is a labelled group of pressed/unpressed buttons that reports the chosen value', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const group = (fixture.nativeElement as HTMLElement).querySelector('app-segmented-control')!;
    const buttons = Array.from(group.querySelectorAll('button'));

    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Filter by status');
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);

    buttons[1]!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.value()).toBe('pending');
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    expect(buttons[1]!.classList).toContain('text-accent');
  });
});
