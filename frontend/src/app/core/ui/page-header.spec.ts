import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './page-header';
import { calendarIcon } from './icons/calendar';

@Component({
  imports: [PageHeader],
  template: `
    <app-page-header [icon]="icon" title="My Appointments" subtitle="Upcoming visits">
      <button type="button">Log Out</button>
    </app-page-header>
  `,
})
class Host {
  readonly icon = calendarIcon;
}

describe('PageHeader', () => {
  it('renders the page heading, subtitle, a decorative icon and the projected actions', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const header = (fixture.nativeElement as HTMLElement).querySelector('app-page-header')!;

    expect(header.getAttribute('role')).toBe('banner');
    expect(header.querySelector('h1')?.textContent).toBe('My Appointments');
    expect(header.querySelector('p')?.textContent).toBe('Upcoming visits');
    expect(header.querySelector('app-icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(header.querySelector('path')?.getAttribute('d')).toBe(calendarIcon);
    expect(header.querySelector('button')?.textContent).toBe('Log Out');
  });
});
