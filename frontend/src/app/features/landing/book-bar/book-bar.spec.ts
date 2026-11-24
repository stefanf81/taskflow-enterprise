import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKING_SECTION_ID, BookBar } from './book-bar';

type ObserverCallback = (entries: { isIntersecting: boolean }[]) => void;

describe('BookBar', () => {
  let fixture: ComponentFixture<BookBar>;
  let section: HTMLElement;
  let callback: ObserverCallback | undefined;
  const disconnect = vi.fn();
  const bar = () => (fixture.nativeElement as HTMLElement).querySelector('div')!;

  beforeEach(() => {
    callback = undefined;
    disconnect.mockClear();
    // jsdom has no IntersectionObserver: a stand-in that lets the test drive it.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: ObserverCallback) {
          callback = cb;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    section = document.createElement('section');
    section.id = BOOKING_SECTION_ID;
    document.body.appendChild(section);
    TestBed.configureTestingModule({ imports: [BookBar] });
    fixture = TestBed.createComponent(BookBar);
    fixture.detectChanges();
  });

  afterEach(() => {
    section.remove();
    vi.unstubAllGlobals();
  });

  it('is a plain link to the booking section, shown on phones only', () => {
    const link = bar().querySelector('a')!;
    expect(link.getAttribute('href')).toBe('#booking');
    expect(link.textContent?.trim()).toBe('Book an appointment');
    expect(link.classList).toContain('btn-submit');
    expect(bar().classList).toContain('lg:hidden');
    expect(bar().classList).not.toContain('hidden');
  });

  it('hides while the booking section is on screen and returns when it is not', () => {
    callback?.([{ isIntersecting: true }]);
    fixture.detectChanges();
    expect(bar().classList).toContain('hidden');

    callback?.([{ isIntersecting: false }]);
    fixture.detectChanges();
    expect(bar().classList).not.toContain('hidden');
  });

  it('stops observing when destroyed', () => {
    fixture.destroy();
    expect(disconnect).toHaveBeenCalled();
  });
});

describe('BookBar without an IntersectionObserver or booking section', () => {
  it('stays visible instead of failing', () => {
    TestBed.configureTestingModule({ imports: [BookBar] });
    const fixture = TestBed.createComponent(BookBar);
    expect(() => fixture.detectChanges()).not.toThrow();
    expect((fixture.nativeElement as HTMLElement).querySelector('div')!.classList).not.toContain(
      'hidden',
    );
  });
});
