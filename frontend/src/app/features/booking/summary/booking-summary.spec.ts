import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SHOP_RULES } from '@taskflow/domain';
import { BookingStore } from '../booking.store';
import { BookingSummary } from './booking-summary';

describe('BookingSummary', () => {
  let fixture: ComponentFixture<BookingSummary>;
  let store: BookingStore;
  let httpMock: HttpTestingController;
  /** The summary's rows as `label -> value` (the elements' text is not separated by spaces). */
  const rows = () =>
    Object.fromEntries(
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('p')).map((row) => [
        row.children[0]?.textContent?.trim(),
        row.children[1]?.textContent?.replace(/\s+/g, ' ').trim(),
      ]),
    );

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 12, 14, 30));
    TestBed.configureTestingModule({
      imports: [BookingSummary],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(BookingSummary);
    store = TestBed.inject(BookingStore);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock
      .match((r) => r.url.endsWith('/api/v1/catalog'))
      .forEach((r) =>
        r.flush([
          {
            id: 1,
            name: 'Modern Skin Fade',
            price: 30,
            durationMinutes: 45,
            category: 'hair',
            description: 'd',
          },
        ]),
      );
    httpMock.match((r) => r.url.includes('/barber-ratings')).forEach((r) => r.flush([]));
    httpMock.match((r) => r.url === '/api/v1/barbers').forEach((r) => r.flush([]));
    httpMock
      .match((r) => r.url.includes('/public/shop'))
      .forEach((r) =>
        r.flush({
          ...DEFAULT_SHOP_RULES,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      );
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.match(() => true);
    vi.useRealTimers();
  });

  it('shows the treatment, duration, stylist and price, and asks for a day before one is chosen', () => {
    store.selectService('Modern Skin Fade');
    store.selectStylist('Sara the Stylist');
    fixture.detectChanges();

    expect(rows()).toEqual({
      'Treatment:': 'Modern Skin Fade',
      'Duration:': '45 mins',
      'Stylist:': 'Sara the Stylist',
      'Scheduled:': 'Pick a day',
      'Total Est. Price:': '$30.00',
    });
  });

  it('asks for a time once a day is chosen but its availability is not known', () => {
    store.selectService('Modern Skin Fade');
    store.selectBookingDate('2026-10-13');
    fixture.detectChanges();

    // The busy-slots lookup is still open, so the preselected time is not a booking yet.
    expect(rows()['Scheduled:']).toMatch(/, pick a time$/);
    expect(rows()['Est. End Time:']).toBeUndefined();
    httpMock.match((r) => r.url.includes('/public/busy-slots'));
  });

  it('shows the day, time and estimated end once the slot is confirmed free', async () => {
    store.selectService('Modern Skin Fade');
    store.selectStylist('Sara the Stylist');
    store.selectBookingDate('2026-10-13');
    TestBed.tick();
    httpMock.match((r) => r.url.includes('/public/busy-slots')).forEach((r) => r.flush([]));
    await fixture.whenStable();
    store.selectTimeSlot('10:00');
    fixture.detectChanges();

    expect(rows()['Scheduled:']).toMatch(/at 10:00 AM$/);
    expect(rows()['Est. End Time:']).toBe('10:45 AM');
  });
});
