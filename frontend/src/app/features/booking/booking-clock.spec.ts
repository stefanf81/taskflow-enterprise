import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, DestroyRef, inject } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { BookingStore } from './booking.store';
import { BookingWizard } from './booking-wizard';

/** Monday 2026-10-12, 14:30 local time. */
const MONDAY_AFTERNOON = new Date(2026, 9, 12, 14, 30);

@Component({ standalone: true, template: '' })
class TestHost {
  readonly store = inject(BookingStore);
}

describe('BookingStore clock (FE-5)', () => {
  let store: BookingStore;
  let httpMock: HttpTestingController;
  let fixture: ComponentFixture<TestHost>;

  const flushBusySlots = (busy: string[] = []) =>
    httpMock.match((r) => r.url.includes('/public/busy-slots')).forEach((r) => r.flush(busy));

  beforeEach(async () => {
    // Fake only Date: Angular's own scheduling keeps real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(MONDAY_AFTERNOON);

    TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(TestHost);
    store = fixture.componentInstance.store;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.match((r) => r.url.includes('/api/v1/catalog')).forEach((r) => r.flush([]));
    httpMock.match((r) => r.url.includes('/barber-ratings')).forEach((r) => r.flush([]));
    httpMock.match((r) => r.url === '/api/v1/barbers').forEach((r) => r.flush([]));
    await fixture.whenStable();
    store.refreshToday();
  });

  afterEach(() => {
    flushBusySlots();
    httpMock.verify();
    vi.useRealTimers();
  });

  it('starts the date carousel at today', () => {
    const days = store.upcomingBookingDays();
    expect(store.today()).toBe('2026-10-12');
    expect(days[0]?.dateStr).toBe('2026-10-12');
    expect(days).toHaveLength(7);
    expect(days.some((d) => d.dayName === 'Sun')).toBe(false);
  });

  it('moves the carousel on when the day changes (it is no longer frozen)', () => {
    vi.setSystemTime(new Date(2026, 9, 13, 9, 0));
    store.refreshToday();

    expect(store.today()).toBe('2026-10-13');
    expect(store.upcomingBookingDays()[0]?.dateStr).toBe('2026-10-13');
  });

  it('drops today from the carousel once no slot is left', () => {
    vi.setSystemTime(new Date(2026, 9, 12, 17, 0));
    store.refreshToday();

    expect(store.upcomingBookingDays()[0]?.dateStr).toBe('2026-10-13');
  });

  it('locks slots that already started today and nothing on later days', () => {
    store.selectBookingDate('2026-10-12');
    flushBusySlots();

    expect(['09:00', '11:00', '13:00', '14:00'].every((s) => store.isSlotPast(s))).toBe(true);
    expect(store.isSlotPast('15:00')).toBe(false);
    expect(store.isSlotPast('16:00')).toBe(false);

    store.selectBookingDate('2026-10-14');
    flushBusySlots();
    expect(store.isSlotPast('09:00')).toBe(false);
  });

  it('moves the preselected 09:00 to the first slot still open when picking today', () => {
    expect(store.bookingTime()).toBe('09:00');

    store.selectBookingDate('2026-10-12');
    flushBusySlots();

    expect(store.bookingTime()).toBe('15:00');
    expect(store.isStepValid(3)).toBe(true);
  });

  it('refuses to select a past slot and keeps step 3 invalid for one', () => {
    store.selectBookingDate('2026-10-12');
    flushBusySlots();

    store.selectTimeSlot('11:00');
    expect(store.bookingTime()).toBe('15:00');

    store.selectTimeSlot('16:00');
    expect(store.bookingTime()).toBe('16:00');

    store.bookingModel.update((m) => ({ ...m, bookingTime: '10:00' }));
    expect(store.isStepValid(3)).toBe(false);
  });

  it('re-validates the selected date when the day rolls over', () => {
    store.selectBookingDate('2026-10-12');
    flushBusySlots(['16:00']);
    expect(store.bookingDate()).toBe('2026-10-12');

    vi.setSystemTime(new Date(2026, 9, 13, 8, 0));
    store.refreshToday();

    expect(store.bookingDate()).toBe('');
    expect(store.busySlots()).toEqual([]);
    expect(store.errorMessage()).toBe(
      'The date you selected is no longer available. Please pick a new date.',
    );
    expect(store.isStepValid(3)).toBe(false);
  });

  it('re-validates the selected time when it starts while the wizard is open', () => {
    store.selectBookingDate('2026-10-12');
    flushBusySlots();
    expect(store.bookingTime()).toBe('15:00');

    vi.setSystemTime(new Date(2026, 9, 12, 15, 30));
    store.refreshToday();

    expect(store.bookingDate()).toBe('2026-10-12');
    expect(store.bookingTime()).toBe('16:00');
  });

  it('never submits a time the customer did not pick (it started while the form was open)', () => {
    store.bookingModel.set({
      customerName: 'Jane',
      customerEmail: 'jane@example.com',
      customerPhone: '555-0100',
      barberName: 'No Preference (First Available)',
      bookingDate: '2026-10-12',
      bookingTime: '15:00',
      serviceType: 'Classic Haircut',
    });
    store.activeStep.set(4);

    vi.setSystemTime(new Date(2026, 9, 12, 15, 5));
    store.submitBooking();

    expect(store.errorMessage()).toBe('That time has already passed. Please pick a later slot.');
    expect(store.activeStep()).toBe(3);
    httpMock.expectNone('/api/v1/appointments');
  });

  it('rejects a date beyond 90 days or in the past from the picker', () => {
    store.selectBookingDate('2026-10-11');
    expect(store.bookingDate()).toBe('');
    store.selectBookingDate('2027-02-20');
    expect(store.bookingDate()).toBe('');
    store.selectBookingDate('2027-01-11'); // 91 days ahead
    expect(store.bookingDate()).toBe('');
    store.selectBookingDate('2027-01-09'); // 89 days ahead (a Saturday)
    expect(store.bookingDate()).toBe('2027-01-09');
    flushBusySlots();
  });
});

describe('BookingStore.watchToday lifecycle (FE-5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 12, 23, 59, 0));
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeOwner = () => {
    const callbacks: (() => void)[] = [];
    const owner = {
      onDestroy: (cb: () => void) => {
        callbacks.push(cb);
        return () => undefined;
      },
    } as unknown as DestroyRef;
    return { owner, destroy: () => callbacks.forEach((cb) => cb()) };
  };

  const setVisibility = (state: DocumentVisibilityState) =>
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });

  it('refreshes on entry, at local midnight, and on tab re-focus; cleans up on destroy', () => {
    const store = TestBed.inject(BookingStore);
    const { owner, destroy } = makeOwner();

    store.watchToday(owner);
    expect(store.today()).toBe('2026-10-12');

    // Midnight timer: one minute (+1s grace) away.
    vi.advanceTimersByTime(59_000);
    expect(store.today()).toBe('2026-10-12');
    vi.advanceTimersByTime(2_000);
    expect(store.today()).toBe('2026-10-13');
    // ...and it re-arms for the next midnight.
    expect(vi.getTimerCount()).toBe(1);

    // A hidden tab ignores the event; a visible one refreshes.
    vi.setSystemTime(new Date(2026, 9, 14, 8, 0));
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(store.today()).toBe('2026-10-13');
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(store.today()).toBe('2026-10-14');

    destroy();
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(new Date(2026, 9, 20, 8, 0));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(store.today()).toBe('2026-10-14');
  });
});

describe('BookingWizard UI (FE-5, FE-10, FE-11, FE-1)', () => {
  let fixture: ComponentFixture<BookingWizard>;
  let store: BookingStore;
  let httpMock: HttpTestingController;

  const el = () => fixture.nativeElement as HTMLElement;
  const buttons = () => Array.from(el().querySelectorAll('button'));

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(MONDAY_AFTERNOON);
    TestBed.configureTestingModule({
      imports: [BookingWizard],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(BookingWizard);
    store = TestBed.inject(BookingStore);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock
      .match((r) => r.url.includes('/api/v1/catalog'))
      .forEach((r) =>
        r.flush([
          {
            id: 1,
            name: 'Classic Haircut',
            price: 25,
            durationMinutes: 30,
            category: 'hair',
            description: 'd',
          },
        ]),
      );
    httpMock.match((r) => r.url.includes('/barber-ratings')).forEach((r) => r.flush([]));
    httpMock.match((r) => r.url === '/api/v1/barbers').forEach((r) => r.flush([]));
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.match(() => true);
    vi.useRealTimers();
  });

  it('disables slots that already started today and labels them', () => {
    store.activeStep.set(3);
    store.selectBookingDate('2026-10-12');
    httpMock.match((r) => r.url.includes('/public/busy-slots')).forEach((r) => r.flush([]));
    fixture.detectChanges();

    const slotButtons = buttons().filter((b) => b.classList.contains('slot-picker-btn'));
    const passed = slotButtons.filter((b) => b.textContent?.includes('Passed'));
    const open = slotButtons.filter((b) => !b.disabled);
    expect(passed).toHaveLength(5); // 09:00 10:00 11:00 13:00 14:00
    expect(passed.every((b) => b.disabled)).toBe(true);
    expect(open.map((b) => b.textContent?.trim())).toEqual(
      expect.arrayContaining(['3:00 PM', '4:00 PM']),
    );
  });

  it('shows an error with a retry (not an all-free grid) when availability fails to load', () => {
    store.activeStep.set(3);
    store.selectBookingDate('2026-10-13');
    httpMock
      .match((r) => r.url.includes('/public/busy-slots'))
      .forEach((r) => r.flush(null, { status: 503, statusText: 'Service Unavailable' }));
    fixture.detectChanges();

    expect(el().textContent).toContain('Could not check availability. Please try again.');
    expect(
      buttons().some(
        (b) => b.classList.contains('slot-picker-btn') && b.textContent?.includes('PM'),
      ),
    ).toBe(false);
    const next = buttons().find((b) => b.textContent?.includes('Next')) as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    buttons()
      .find((b) => b.textContent?.trim() === 'Retry')!
      .click();
    httpMock.match((r) => r.url.includes('/public/busy-slots')).forEach((r) => r.flush([]));
    fixture.detectChanges();

    expect(el().textContent).not.toContain('Could not check availability');
    expect(next.disabled).toBe(false);
  });

  it('shows the email field message for "a@b" before submit', () => {
    store.activeStep.set(4);
    store.bookingModel.update((m) => ({ ...m, customerEmail: 'a@b' }));
    fixture.detectChanges();

    expect(el().querySelector('#customerEmail-error')?.textContent).toContain(
      'Invalid email format',
    );
    expect(el().querySelector('#customerEmail')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps rendering with retry prompts when the catalog and roster fail to load', async () => {
    store.retryCatalog();
    store.retryRoster();
    fixture.detectChanges();
    httpMock
      .match((r) => r.url.includes('/api/v1/catalog') || r.url === '/api/v1/barbers')
      .forEach((r) => r.flush(null, { status: 500, statusText: 'Server Error' }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el().textContent).toContain('Could not load service catalog.');
    expect(buttons().some((b) => b.textContent?.trim() === 'Retry')).toBe(true);

    store.activeStep.set(2);
    fixture.detectChanges();
    expect(el().textContent).toContain('Could not load the barber directory.');
    expect(el().textContent).toContain('No Preference');
  });
});
