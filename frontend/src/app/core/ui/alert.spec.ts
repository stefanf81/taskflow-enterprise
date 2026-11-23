import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { Alert, AlertTone } from './alert';

@Component({
  imports: [Alert],
  template: `
    <app-alert
      [tone]="tone()"
      class="mb-6"
      [dismissible]="dismissible()"
      (dismissed)="closed = true"
    >
      Something happened
      <button type="button" alertAction>Retry</button>
    </app-alert>
  `,
})
class Host {
  readonly tone = signal<AlertTone>('error');
  readonly dismissible = signal(true);
  closed = false;
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const alert = (fixture.nativeElement as HTMLElement).querySelector('app-alert') as HTMLElement;
  return { fixture, alert };
}

describe('Alert', () => {
  it('announces an error at once and keeps the e2e hook classes and the caller margin', () => {
    const { alert } = render();
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.getAttribute('aria-live')).toBeNull();
    expect([...alert.classList]).toEqual(
      expect.arrayContaining(['alert', 'alert-error', 'tone-danger', 'mb-6']),
    );
    expect(alert.textContent).toContain('Something happened');
  });

  it('is a polite status for success, warning and info', () => {
    const { fixture, alert } = render();
    for (const tone of ['success', 'warning', 'info'] as const) {
      fixture.componentInstance.tone.set(tone);
      fixture.detectChanges();
      expect(alert.getAttribute('role')).toBe('status');
      expect(alert.getAttribute('aria-live')).toBe('polite');
      expect(alert.classList).toContain(`alert-${tone}`);
    }
  });

  it('puts the action last and emits dismissed from its × button', () => {
    const { fixture, alert } = render();
    const buttons = Array.from(alert.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Retry', '×']);
    expect(buttons[1]!.getAttribute('aria-label')).toBe('Dismiss error');

    buttons[1]!.click();
    expect(fixture.componentInstance.closed).toBe(true);
  });

  it('has no × button unless dismissible', () => {
    const { fixture, alert } = render();
    fixture.componentInstance.dismissible.set(false);
    fixture.detectChanges();
    expect(alert.querySelector('button[aria-label]')).toBeNull();
  });
});
