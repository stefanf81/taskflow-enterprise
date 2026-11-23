import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

@Component({
  imports: [Button],
  template: `
    <button id="primary" appButton>Book</button>
    <button id="secondary" appButton="secondary" class="mt-4">Retry</button>
    <a id="danger" href="/" appButton="danger">Sign out</a>
  `,
})
class Host {}

describe('Button', () => {
  it('maps each variant to the shared .btn classes and keeps the element own classes', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = (id: string) => (fixture.nativeElement as HTMLElement).querySelector(`#${id}`)!;

    expect([...el('primary').classList]).toEqual(expect.arrayContaining(['btn', 'btn-submit']));
    expect([...el('secondary').classList]).toEqual(
      expect.arrayContaining(['btn', 'btn-secondary', 'mt-4']),
    );
    expect([...el('danger').classList]).toEqual(expect.arrayContaining(['btn', 'btn-danger']));
    expect(el('danger').tagName).toBe('A');
  });
});
