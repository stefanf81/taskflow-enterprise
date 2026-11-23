import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { EmptyState, EmptyStateKind } from './empty-state';
import { calendarIcon } from './icons/calendar';
import { hourglassIcon } from './icons/hourglass';

@Component({
  imports: [EmptyState],
  template: `
    <app-empty-state
      [kind]="kind()"
      title="Nothing here"
      [description]="description()"
      [icon]="icon()"
    >
      <button type="button">Book now</button>
    </app-empty-state>
  `,
})
class Host {
  readonly kind = signal<EmptyStateKind>('empty');
  readonly description = signal('');
  readonly icon = signal<string | undefined>(undefined);
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const root = (fixture.nativeElement as HTMLElement).querySelector('app-empty-state')!;
  const path = () => root.querySelector('path')!.getAttribute('d');
  return { fixture, root, path };
}

describe('EmptyState', () => {
  it('shows the title, the projected action and no description paragraph when there is none', () => {
    const { root } = render();
    expect(root.querySelector('h3')?.textContent).toBe('Nothing here');
    expect(root.querySelector('p')).toBeNull();
    expect(root.querySelector('button')?.textContent).toBe('Book now');
    expect(root.getAttribute('role')).toBeNull();
  });

  it('is a status while loading (with an hourglass) and an alert on error', () => {
    const { fixture, root, path } = render();
    fixture.componentInstance.kind.set('loading');
    fixture.detectChanges();
    expect(root.getAttribute('role')).toBe('status');
    expect(path()).toBe(hourglassIcon);

    fixture.componentInstance.kind.set('error');
    fixture.componentInstance.description.set('Try again later.');
    fixture.detectChanges();
    expect(root.getAttribute('role')).toBe('alert');
    expect(root.querySelector('p')?.textContent).toBe('Try again later.');
  });

  it('takes a custom icon', () => {
    const { fixture, path } = render();
    fixture.componentInstance.icon.set(calendarIcon);
    fixture.detectChanges();
    expect(path()).toBe(calendarIcon);
  });
});
