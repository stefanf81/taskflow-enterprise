import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, inject } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { BookingStore } from './booking.store';

/** Minimal host so the BookingStore's httpResources are actually loaded. */
@Component({
  standalone: true,
  template: '{{ store.services().length }}',
})
class Host {
  readonly store = inject(BookingStore);
}

describe('BookingStore Quality Assurance Suite', () => {
  let fixture: ComponentFixture<Host>;
  let store: BookingStore;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    sessionStorage.removeItem('auth_token');

    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(Host);
    store = fixture.componentInstance.store;
    httpMock = TestBed.inject(HttpTestingController);

    const mockServices = [
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
        id: 4,
        name: 'Royal Hot Towel Shave',
        price: 22,
        durationMinutes: 30,
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
    const mockRatings = [
      { barberName: 'Alex the Barber', averageRating: 4.8, reviewCount: 12 },
      { barberName: 'Sara the Stylist', averageRating: 4.9, reviewCount: 15 },
      { barberName: 'Marcus Master Blade', averageRating: 5.0, reviewCount: 8 },
    ];

    fixture.detectChanges();

    httpMock
      .match((req) => req.url.includes('/api/v1/catalog'))
      .forEach((req) => req.flush(mockServices));
    httpMock
      .match((req) => req.url.includes('/api/v1/reviews/public/barber-ratings'))
      .forEach((req) => req.flush(mockRatings));
    httpMock.match(() => true).forEach((req) => req.flush([]));

    await fixture.whenStable();
  });

  it('should compile and bootstrap the BookingStore cleanly', () => {
    expect(store).toBeTruthy();
  });

  it('should initialize with step 1 and default booking options', () => {
    expect(store.activeStep()).toBe(1);
    expect(store.bookingService()).toBe('Classic Haircut');
    expect(store.bookingBarber()).toBe('No Preference (First Available)');
    expect(store.selectedCategory()).toBe('all');
  });

  it('should calculate the 7-day upcoming booking carousel dynamically, skipping Sundays', () => {
    const days = store.upcomingBookingDays();
    expect(days.length).toBe(7);
    const hasSunday = days.some((d) => d.dayName === 'Sun');
    expect(hasSunday).toBe(false);
    days.forEach((day) => {
      expect(day.dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(day.dayNum).toBeGreaterThan(0);
      expect(day.dayNum).toBeLessThan(32);
    });
  });

  it('should dynamically filter services based on category tabs', () => {
    store.setServiceCategory('all');
    expect(store.filteredServices().length).toBe(store.services().length);

    store.setServiceCategory('hair');
    const hairServices = store.filteredServices();
    expect(hairServices.length).toBe(2);
    hairServices.forEach((s) => expect(s.category).toBe('hair'));

    store.setServiceCategory('beard');
    const beardServices = store.filteredServices();
    expect(beardServices.length).toBe(2);
    beardServices.forEach((s) => expect(s.category).toBe('beard'));
  });

  it('should enforce step validation rules for guided wizard progression', () => {
    expect(store.isStepValid(1)).toBe(true);
    store.bookingService.set('');
    expect(store.isStepValid(1)).toBe(false);
    store.bookingService.set('Classic Haircut');
    expect(store.isStepValid(1)).toBe(true);
    expect(store.isStepValid(2)).toBe(true);
    expect(store.isStepValid(3)).toBe(false);
    store.bookingDate.set('2026-06-25');
    store.bookingTime.set('10:00');
    expect(store.isStepValid(3)).toBe(true);
    store.busySlots.set(['10:00']);
    expect(store.isStepValid(3)).toBe(false);
  });

  it('should compute real-time itemized checkout subtotals, fees, and totals dynamically', () => {
    store.selectService('Classic Haircut');
    expect(store.checkoutSubtotal()).toBe(25);
    expect(store.checkoutFee()).toBe(2.5);
    expect(store.checkoutTotal()).toBe(27.5);
    store.selectService('The Executive Package');
    expect(store.checkoutSubtotal()).toBe(40);
    expect(store.checkoutFee()).toBe(2.5);
    expect(store.checkoutTotal()).toBe(42.5);
  });

  it('should translate 24-hour database representations into beautiful 12-hour AM/PM formats', () => {
    expect(store.formatTime12Hour('09:00')).toBe('9:00 AM');
    expect(store.formatTime12Hour('13:00')).toBe('1:00 PM');
    expect(store.formatTime12Hour('12:00')).toBe('12:00 PM');
    expect(store.formatTime12Hour('15:30')).toBe('3:30 PM');
  });

  it('should compute the estimated completion end time based on service duration', () => {
    store.bookingService.set('Classic Haircut');
    store.bookingTime.set('10:00');
    expect(store.estimatedEndTime()).toBe('10:30');
    store.bookingService.set('Modern Skin Fade');
    store.bookingTime.set('13:15');
    expect(store.estimatedEndTime()).toBe('14:00');
  });

  it('should manage interactive FAQ expand/collapse toggle states', () => {
    expect(store.activeFaq()).toBeNull();
    store.toggleFaq(0);
    expect(store.activeFaq()).toBe(0);
    store.toggleFaq(0);
    expect(store.activeFaq()).toBeNull();
    store.toggleFaq(2);
    expect(store.activeFaq()).toBe(2);
  });

  it('should support non-HTTP simple helper methods', () => {
    store.selectStylist('Sara the Stylist');
    expect(store.bookingBarber()).toBe('Sara the Stylist');
    store.selectLookbookStyle('Classic Haircut', 'hair');
    expect(store.bookingService()).toBe('Classic Haircut');
    expect(store.selectedCategory()).toBe('hair');
    expect(store.activeStep()).toBe(2);
  });
});
