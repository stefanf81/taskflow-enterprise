import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, inject } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { BookingStore } from './booking.store';
import { ServiceItem, PublicBarber, BarberRating, AppointmentItem } from '../../types/api';

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
    store.bookingModel.update((m) => ({ ...m, bookingDate: '2026-06-25', bookingTime: '10:00' }));
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
      bookingDate: '2999-06-25',
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
      bookingDate: '2999-06-25',
      bookingTime: '10:00',
      serviceType: 'Classic Haircut',
    });

    const created = { id: 1, publicId: 'pub-1' } as AppointmentItem;
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
      bookingDate: '2999-06-25',
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
      bookingDate: '2999-06-25',
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
});
