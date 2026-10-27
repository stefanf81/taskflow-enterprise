import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, inject } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { BookingStore } from './booking.store';
import { ServiceItem, PublicBarber, BarberRating, AppointmentItem } from '../../types/api';
import { toLocalDateString } from '../../time-utils';
import { AuthState } from '../../auth.state';
import { NETWORK_ERROR_MESSAGE } from '../../core/api/extract-api-error';
import { LookbookSelectionBus } from './lookbook-selection';

/** A bookable (non-Sunday, within 90 days, never today) date for tests that run on the real clock. */
const FUTURE = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 10);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return toLocalDateString(d);
})();

@Component({ standalone: true, template: '' })
class TestHost {
  readonly store = inject(BookingStore);
}

describe('BookingStore', () => {
  let store: BookingStore;
  let httpMock: HttpTestingController;
  let fixture: ComponentFixture<TestHost>;

  const mockServices: ServiceItem[] = [
    {
      id: 1,
      name: 'Classic Haircut',
      price: 25,
      durationMinutes: 30,
      category: 'hair',
      description: 'Desc',
    },
    {
      id: 2,
      name: 'Modern Skin Fade',
      price: 30,
      durationMinutes: 45,
      category: 'hair',
      description: 'Desc',
    },
    {
      id: 3,
      name: 'Beard Trim & Shave',
      price: 18,
      durationMinutes: 25,
      category: 'beard',
      description: 'Desc',
    },
    {
      id: 5,
      name: 'The Executive Package',
      price: 40,
      durationMinutes: 60,
      category: 'combo',
      description: 'Desc',
    },
  ];

  const mockBarbers: PublicBarber[] = [
    { id: 1, name: 'Alex the Barber' },
    { id: 2, name: 'Sara the Stylist' },
  ];

  const mockRatings: BarberRating[] = [
    { barberName: 'Alex the Barber', averageRating: 4.8, reviewCount: 12 },
  ];

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    fixture = TestBed.createComponent(TestHost);
    store = fixture.componentInstance.store;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    httpMock
      .match((req) => req.url.includes('/api/v1/catalog'))
      .forEach((req) => req.flush(mockServices));
    httpMock
      .match((req) => req.url.includes('/api/v1/reviews/public/barber-ratings'))
      .forEach((req) => req.flush(mockRatings));
    httpMock.match((req) => req.url === '/api/v1/barbers').forEach((req) => req.flush(mockBarbers));
    // The shop's zone is the machine's own, so the wizard's clock is unchanged in these specs.
    httpMock
      .match((r) => r.url.includes('/public/shop'))
      .forEach((r) => r.flush({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    // Stale-slot rejection refreshes availability; drain that lookup.
    httpMock.match((req) => req.url.includes('/public/busy-slots')).forEach((req) => req.flush([]));
    httpMock.verify();
  });

  it('starts on step 1 with the default booking options', () => {
    expect(store.activeStep()).toBe(1);
    expect(store.bookingService()).toBe('Classic Haircut');
    expect(store.bookingBarber()).toBe('No Preference (First Available)');
    expect(store.selectedCategory()).toBe('all');
  });

  it('preselects the first catalog service instead of a hard-coded name', () => {
    expect(store.bookingService()).toBe(mockServices[0]!.name);
    expect(store.isStepValid(1)).toBe(true);
  });

  it('does not accept a service the catalog does not offer', () => {
    store.bookingModel.update((m) => ({ ...m, serviceType: 'Retired Service' }));
    expect(store.isStepValid(1)).toBe(false);
  });

  it('rejects a lookbook style the catalog does not offer and stays on step 1', () => {
    store.selectLookbookStyle('Retired Service', 'hair');
    expect(store.activeStep()).toBe(1);
    expect(store.bookingService()).not.toBe('Retired Service');
    expect(store.errorMessage()).toContain('Retired Service');
  });

  it('builds the stylist roster from the public API and joins ratings', () => {
    const profiles = store.stylistProfiles();
    expect(profiles.map((p) => p.name)).toEqual(['Alex the Barber', 'Sara the Stylist']);
    expect(profiles[0]!.rating).toBe('4.8 ★');
    expect(profiles[0]!.reviews).toBe('12 reviews');
    expect(profiles[1]!.reviews).toBe('New');
  });

  it('computes the 7-day carousel while skipping Sundays', () => {
    const days = store.upcomingBookingDays();
    expect(days.length).toBe(7);
    expect(days.some((d) => d.dayName === 'Sun')).toBe(false);
    days.forEach((day) => {
      expect(day.dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('filters the catalog by category tab', () => {
    store.setServiceCategory('all');
    expect(store.filteredServices().length).toBe(store.services().length);

    store.setServiceCategory('hair');
    expect(store.filteredServices().length).toBe(2);
    store.filteredServices().forEach((s) => expect(s.category).toBe('hair'));

    store.setServiceCategory('beard');
    expect(store.filteredServices().length).toBe(1);
  });

  it('enforces the guided wizard step validation rules', () => {
    expect(store.isStepValid(1)).toBe(true);
    store.selectService('');
    expect(store.isStepValid(1)).toBe(false);
    store.selectService('Classic Haircut');

    expect(store.isStepValid(2)).toBe(true);

    expect(store.isStepValid(3)).toBe(false);
    store.bookingModel.update((m) => ({ ...m, bookingDate: FUTURE, bookingTime: '10:00' }));
    expect(store.isStepValid(3)).toBe(true);

    store.busySlots.set(['10:00']);
    expect(store.isStepValid(3)).toBe(false);
  });

  it('validates step 4 from the contact fields', () => {
    store.bookingModel.update((m) => ({
      ...m,
      customerName: 'Test User',
      customerEmail: 'test@example.com',
      customerPhone: '1234567890',
    }));
    expect(store.isStepValid(4)).toBe(true);

    store.bookingModel.update((m) => ({ ...m, customerName: '' }));
    expect(store.isStepValid(4)).toBe(false);
  });

  it('computes checkout totals and estimated end times from the catalog', () => {
    store.selectService('Classic Haircut');
    expect(store.checkoutTotal()).toBe(25);
    expect(store.formattedTotal()).toBe('$25.00');

    store.bookingModel.update((m) => ({
      ...m,
      serviceType: 'Modern Skin Fade',
      bookingTime: '13:15',
    }));
    expect(store.estimatedEndTime()).toBe('14:00');
  });

  it('hands a lookbook selection to the wizard and advances to step 2', () => {
    store.selectLookbookStyle('Classic Haircut', 'hair');
    expect(store.bookingService()).toBe('Classic Haircut');
    expect(store.selectedCategory()).toBe('hair');
    expect(store.activeStep()).toBe(2);
    expect(store.successMessage()).toContain('Lookbook Style selected');
  });

  it('applies a lookbook pick made through the bus after the wizard exists', () => {
    // A pick made before the store exists is covered by the 'BookingStore lookbook hand-off'
    // suite below; this one checks that an already-constructed store reacts to the bus.
    expect(store.activeStep()).toBe(1);

    TestBed.inject(LookbookSelectionBus).select('Modern Skin Fade', 'hair');
    fixture.detectChanges();

    expect(store.bookingService()).toBe('Modern Skin Fade');
    expect(store.selectedCategory()).toBe('hair');
    expect(store.activeStep()).toBe(2);
  });

  it('selects a stylist and refreshes slot availability', async () => {
    store.selectStylist('Sara the Stylist');
    expect(store.bookingBarber()).toBe('Sara the Stylist');
    httpMock.match((req) => req.url.includes('/public/busy-slots')).forEach((req) => req.flush([]));
    await fixture.whenStable();
  });

  it('submits a booking and opens the receipt on success', async () => {
    store.bookingModel.set({
      customerName: 'Jane Smith',
      customerEmail: 'jane@example.com',
      customerPhone: '555-0100',
      barberName: 'No Preference (First Available)',
      bookingDate: FUTURE,
      bookingTime: '10:00',
      serviceType: 'Classic Haircut',
    });

    store.submitBooking();

    const req = httpMock.expectOne('/api/v1/appointments');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      customerName: 'Jane Smith',
      customerEmail: 'jane@example.com',
      customerPhone: '555-0100',
      barberName: 'No Preference (First Available)',
      bookingDate: FUTURE,
      bookingTime: '10:00',
      serviceType: 'Classic Haircut',
    });

    const created: AppointmentItem = {
      id: 1,
      publicId: 'pub-1',
      customerName: 'Jane Smith',
      customerEmail: 'jane@example.com',
      customerPhone: '555-0100',
      barberName: 'Sara the Stylist',
      bookingDate: FUTURE,
      bookingTime: '10:00',
      serviceType: 'Classic Haircut',
      status: 'PENDING',
      createdAt: '2999-06-01T10:00:00',
      updatedAt: '2999-06-01T10:00:00',
    };
    req.flush(created);
    await fixture.whenStable();

    expect(store.lastBookedAppointment()).toEqual(created);
    expect(store.showReceiptModal()).toBe(true);
    expect(store.bookingModel().customerName).toBe('');
    expect(store.isSubmitting()).toBe(false);
  });

  it('refuses a stale slot that was taken since the last availability check', () => {
    store.bookingModel.update((m) => ({
      ...m,
      customerName: 'Jane',
      customerEmail: 'jane@example.com',
      customerPhone: '555',
      bookingDate: FUTURE,
      bookingTime: '10:00',
    }));
    store.busySlots.set(['10:00']);

    store.submitBooking();

    expect(store.errorMessage()).toBe('That time slot was just taken. Please pick another slot.');
    httpMock.expectNone('/api/v1/appointments');
  });

  it('surfaces a submission failure', async () => {
    // The store logs raw HTTP errors in dev mode; keep the test output clean.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    store.bookingModel.update((m) => ({
      ...m,
      customerName: 'Jane',
      customerEmail: 'jane@example.com',
      customerPhone: '555',
      bookingDate: FUTURE,
    }));

    store.submitBooking();
    httpMock
      .expectOne('/api/v1/appointments')
      .flush({ message: 'Slot conflict' }, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();

    expect(store.errorMessage()).toBe('Slot conflict');
    expect(store.isSubmitting()).toBe(false);
    consoleError.mockRestore();
  });

  it('reuses the Idempotency-Key across retries and rotates it after success', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const payload = {
      customerName: 'Jane Smith',
      customerEmail: 'jane@example.com',
      customerPhone: '555-0100',
      barberName: 'No Preference (First Available)',
      bookingDate: FUTURE,
      bookingTime: '10:00',
      serviceType: 'Classic Haircut',
    };
    const created: AppointmentItem = {
      id: 1,
      publicId: 'pub-1',
      ...payload,
      status: 'PENDING',
      createdAt: '2999-06-01T10:00:00',
      updatedAt: '2999-06-01T10:00:00',
    };

    store.bookingModel.set(payload);
    store.submitBooking();
    const first = httpMock.expectOne('/api/v1/appointments');
    const firstKey = first.request.headers.get('Idempotency-Key');
    expect(firstKey).toBeTruthy();
    first.flush({ message: 'Server error' }, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();

    // Identical retry must reuse the key so the server can replay the booking.
    store.submitBooking();
    const retry = httpMock.expectOne('/api/v1/appointments');
    expect(retry.request.headers.get('Idempotency-Key')).toBe(firstKey);
    retry.flush(created);
    await fixture.whenStable();

    // A new booking after success must use a fresh key.
    store.bookingModel.set(payload);
    store.submitBooking();
    const next = httpMock.expectOne('/api/v1/appointments');
    expect(next.request.headers.get('Idempotency-Key')).not.toBe(firstKey);
    next.flush(created);
    await fixture.whenStable();
    consoleError.mockRestore();
  });

  it('mints a new Idempotency-Key when the payload changes after a failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    store.bookingModel.set({
      customerName: 'Jane Smith',
      customerEmail: 'jane@example.com',
      customerPhone: '555-0100',
      barberName: 'No Preference (First Available)',
      bookingDate: FUTURE,
      bookingTime: '10:00',
      serviceType: 'Classic Haircut',
    });

    store.submitBooking();
    const first = httpMock.expectOne('/api/v1/appointments');
    const firstKey = first.request.headers.get('Idempotency-Key');
    first.flush({ message: 'Server error' }, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();

    store.bookingModel.update((m) => ({ ...m, serviceType: 'Modern Skin Fade' }));
    store.submitBooking();
    const second = httpMock.expectOne('/api/v1/appointments');
    expect(second.request.headers.get('Idempotency-Key')).not.toBe(firstKey);
    second.flush({ message: 'Server error' }, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    consoleError.mockRestore();
  });

  describe('receipt price (FE-2)', () => {
    it('keeps the price of the service that was booked after the form resets', async () => {
      store.bookingModel.set({
        customerName: 'Jane Smith',
        customerEmail: 'jane@example.com',
        customerPhone: '555-0100',
        barberName: 'No Preference (First Available)',
        bookingDate: FUTURE,
        bookingTime: '10:00',
        serviceType: 'The Executive Package',
      });

      store.submitBooking();
      httpMock.expectOne('/api/v1/appointments').flush({
        id: 7,
        publicId: 'pub-7',
        customerName: 'Jane Smith',
        customerEmail: 'jane@example.com',
        customerPhone: '555-0100',
        barberName: 'Alex the Barber',
        bookingDate: FUTURE,
        bookingTime: '10:00',
        serviceType: 'The Executive Package',
        status: 'PENDING',
        createdAt: '2026-10-01T10:00:00',
        updatedAt: '2026-10-01T10:00:00',
      } satisfies AppointmentItem);
      await fixture.whenStable();

      // The form reset flips the live selection back to the catalog's first service...
      expect(store.bookingService()).toBe('Classic Haircut');
      expect(store.checkoutTotal()).toBe(25);
      // ...but the receipt still shows what was booked.
      expect(store.lastBookedTotal()).toBe(40);
      expect(store.lastBookedAppointment()?.serviceType).toBe('The Executive Package');
    });
  });

  describe('client-side validation messages (FE-10)', () => {
    const contact = {
      customerName: 'Jane Smith',
      customerPhone: '555-0100',
      bookingDate: FUTURE,
    };

    it('rejects "a@b" with a field message before anything is sent', () => {
      store.bookingModel.update((m) => ({ ...m, ...contact, customerEmail: 'a@b' }));

      expect(store.emailError()).toBe('Invalid email format');
      expect(store.isStepValid(4)).toBe(false);

      store.submitBooking();

      expect(store.errorMessage()).toBe('Invalid email format');
      httpMock.expectNone('/api/v1/appointments');
    });

    it('accepts a normal address', () => {
      store.bookingModel.update((m) => ({ ...m, ...contact, customerEmail: 'jane@example.com' }));
      expect(store.emailError()).toBeNull();
      expect(store.isStepValid(4)).toBe(true);
    });

    it('asks for an email when the field is empty', () => {
      expect(store.emailError()).toBe('Valid email address is required.');
    });

    it.each([
      [400, 'Booking must be in the future'],
      [409, 'You already have 5 active bookings'],
      [503, 'Booking is temporarily unavailable, please retry'],
    ])('shows the server message for a %i', async (status, message) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      store.bookingModel.update((m) => ({
        ...m,
        ...contact,
        customerEmail: 'jane@example.com',
      }));

      store.submitBooking();
      httpMock.expectOne('/api/v1/appointments').flush({ message }, { status, statusText: 'x' });
      await fixture.whenStable();

      expect(store.errorMessage()).toBe(message);
      consoleError.mockRestore();
    });

    it('says the server is unreachable on a network failure', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      store.bookingModel.update((m) => ({
        ...m,
        ...contact,
        customerEmail: 'jane@example.com',
      }));

      store.submitBooking();
      httpMock.expectOne('/api/v1/appointments').error(new ProgressEvent('error'));
      await fixture.whenStable();

      expect(store.errorMessage()).toBe(NETWORK_ERROR_MESSAGE);
      consoleError.mockRestore();
    });
  });

  describe('busy-slot lookups (FE-11)', () => {
    it('sends the selected service and refreshes when the service changes', async () => {
      store.selectBookingDate(FUTURE);
      const first = httpMock.expectOne((r) => r.url.includes('/public/busy-slots'));
      expect(first.request.params.get('serviceType')).toBe(store.bookingService());
      first.flush([]);
      await fixture.whenStable();

      // A longer service may not fit where a shorter one does: availability is re-queried.
      store.selectService('Royal Hot Towel Shave');
      const second = httpMock.expectOne((r) => r.url.includes('/public/busy-slots'));
      expect(second.request.params.get('serviceType')).toBe('Royal Hot Towel Shave');
      second.flush([]);
      await fixture.whenStable();
    });

    it('does not validate step 3 against the previous date while a lookup is running', async () => {
      store.selectBookingDate(FUTURE);
      expect(store.isCheckingSlots()).toBe(true);
      expect(store.isStepValid(3)).toBe(false);

      httpMock.expectOne((r) => r.url.includes('/public/busy-slots')).flush([]);
      await fixture.whenStable();

      expect(store.isCheckingSlots()).toBe(false);
      expect(store.isStepValid(3)).toBe(true);
    });

    it('treats a failed lookup as unknown: error shown, step 3 blocked until a retry succeeds', async () => {
      store.activeStep.set(3);
      store.selectBookingDate(FUTURE);
      httpMock
        .expectOne((r) => r.url.includes('/public/busy-slots'))
        .flush({ message: 'Unknown barber' }, { status: 400, statusText: 'Bad Request' });
      await fixture.whenStable();

      expect(store.slotsError()).toBe('Unknown barber');
      expect(store.busySlots()).toEqual([]);
      expect(store.isStepValid(3)).toBe(false);
      store.goToNextStep();
      expect(store.activeStep()).toBe(3);

      store.onBarberOrDateChange(); // the grid's Retry button
      httpMock.expectOne((r) => r.url.includes('/public/busy-slots')).flush(['11:00']);
      await fixture.whenStable();

      expect(store.slotsError()).toBeNull();
      expect(store.busySlots()).toEqual(['11:00']);
      expect(store.isStepValid(3)).toBe(true);
    });

    it('uses a generic message when the lookup fails without a body (503)', async () => {
      store.selectBookingDate(FUTURE);
      httpMock
        .expectOne((r) => r.url.includes('/public/busy-slots'))
        .flush(null, { status: 503, statusText: 'Service Unavailable' });
      await fixture.whenStable();

      expect(store.slotsError()).toBe('Could not check availability. Please try again.');
    });

    it('refuses to submit while availability is unknown', async () => {
      store.bookingModel.update((m) => ({
        ...m,
        customerName: 'Jane',
        customerEmail: 'jane@example.com',
        customerPhone: '555',
      }));
      store.selectBookingDate(FUTURE);
      httpMock
        .expectOne((r) => r.url.includes('/public/busy-slots'))
        .flush(null, { status: 503, statusText: 'x' });
      await fixture.whenStable();

      store.submitBooking();

      expect(store.errorMessage()).toBe('Could not check availability. Please try again.');
      httpMock.expectNone('/api/v1/appointments');
    });
  });

  describe('booking window', () => {
    it('refuses a date beyond the 90-day horizon', () => {
      store.selectBookingDate('2999-01-01');
      expect(store.bookingDate()).toBe('');
      expect(store.errorMessage()).toContain('90 days');
      httpMock.expectNone((r) => r.url.includes('/public/busy-slots'));
    });
  });

  describe('signed-in customer booking (FE-7)', () => {
    it('pre-fills the email from the session and keeps all contact fields editable', () => {
      TestBed.inject(AuthState).applyRole('ROLE_CUSTOMER', 'jane@example.com');

      store.prefillFromSession();
      expect(store.bookingEmail()).toBe('jane@example.com');

      store.bookingModel.update((m) => ({
        ...m,
        customerName: 'Typed Name',
        customerEmail: 'x@y.co',
      }));
      store.prefillFromSession();
      expect(store.bookingName()).toBe('Typed Name');
      expect(store.bookingEmail()).toBe('x@y.co');
      httpMock.match(() => true);
    });

    it('keeps the pre-filled contact after a booking resets the form', () => {
      TestBed.inject(AuthState).applyRole('ROLE_CUSTOMER', 'jane@example.com');
      store.prefillFromSession();

      store.resetBookingForm();

      expect(store.bookingEmail()).toBe('jane@example.com');
      httpMock.match(() => true);
    });

    it('drops contact details, receipt and form when the session ends', () => {
      const auth = TestBed.inject(AuthState);
      auth.applyRole('ROLE_CUSTOMER', 'jane@example.com');
      store.prefillFromSession();
      store.lastBookedAppointment.set({ id: 1 } as AppointmentItem);
      store.showReceiptModal.set(true);

      auth.clear();

      expect(store.bookingEmail()).toBe('');
      expect(store.lastBookedAppointment()).toBeNull();
      expect(store.showReceiptModal()).toBe(false);
      httpMock.match(() => true);
    });
  });
});

describe('BookingStore lookbook hand-off', () => {
  const services: ServiceItem[] = [
    {
      id: 1,
      name: 'Classic Haircut',
      price: 25,
      durationMinutes: 30,
      category: 'hair',
      description: 'Desc',
    },
    {
      id: 2,
      name: 'Modern Skin Fade',
      price: 30,
      durationMinutes: 45,
      category: 'hair',
      description: 'Desc',
    },
  ];

  afterEach(() => {
    const httpMock = TestBed.inject(HttpTestingController);
    httpMock.match(() => true);
    httpMock.verify();
  });

  it('applies a pick made before BookingStore was constructed, once the catalog has loaded', async () => {
    TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    // The lookbook is clicked while the deferred wizard (and with it the store) does not exist.
    TestBed.inject(LookbookSelectionBus).select('Modern Skin Fade', 'hair');

    const fixture = TestBed.createComponent(TestHost);
    const store = fixture.componentInstance.store;
    const httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    // Catalog still in flight: the pick waits instead of being rejected as unknown.
    expect(store.activeStep()).toBe(1);
    expect(store.errorMessage()).toBeFalsy();

    httpMock.match((r) => r.url.includes('/api/v1/catalog')).forEach((r) => r.flush(services));
    httpMock.match((r) => r.url === '/api/v1/barbers').forEach((r) => r.flush([]));
    httpMock
      .match((r) => r.url.includes('/api/v1/reviews/public/barber-ratings'))
      .forEach((r) => r.flush([]));
    httpMock
      .match((r) => r.url.includes('/public/shop'))
      .forEach((r) => r.flush({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.bookingService()).toBe('Modern Skin Fade');
    expect(store.selectedCategory()).toBe('hair');
    expect(store.activeStep()).toBe(2);
    expect(store.errorMessage()).toBeFalsy();
  });
});
