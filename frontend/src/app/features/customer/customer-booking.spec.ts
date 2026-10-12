import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { CustomerBooking } from './customer-booking';
import { BookingStore } from '../booking/booking.store';
import { AuthState } from '../../auth.state';
import { AppointmentPage } from '../../types/api';

describe('CustomerBooking (signed-in booking entry, FE-7)', () => {
  let fixture: ComponentFixture<CustomerBooking>;
  let httpMock: HttpTestingController;
  let store: BookingStore;

  const history: AppointmentPage = {
    content: [
      {
        id: 4,
        publicId: 'pub-4',
        customerName: 'Jane Smith',
        customerEmail: 'jane@example.com',
        customerPhone: '555-0100',
        barberName: 'Alex the Barber',
        bookingDate: '2026-08-01',
        bookingTime: '10:00',
        serviceType: 'Classic Haircut',
        status: 'APPROVED',
        createdAt: '2026-07-01T00:00:00',
        updatedAt: '2026-07-01T00:00:00',
      },
    ],
    page: { number: 0, size: 10, totalElements: 1, totalPages: 1 },
  };

  const drain = (): void => {
    httpMock.match((r) => r.url.includes('/api/v1/catalog')).forEach((r) => r.flush([]));
    httpMock.match((r) => r.url.includes('/barber-ratings')).forEach((r) => r.flush([]));
    httpMock.match((r) => r.url === '/api/v1/barbers').forEach((r) => r.flush([]));
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [CustomerBooking],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(BookingStore);
    TestBed.inject(AuthState).applyRole('ROLE_CUSTOMER', 'jane@example.com');

    fixture = TestBed.createComponent(CustomerBooking);
    fixture.detectChanges();
    drain();
    await Promise.resolve();
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.match(() => true);
  });

  it('hosts the booking wizard with a way back to the portal', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-booking-wizard')).toBeTruthy();
    expect(el.querySelector('a[href="/customer"]')?.textContent).toContain('My Appointments');
    expect(el.querySelector('h1')?.textContent).toContain('Book an Appointment');
  });

  it('pre-fills the email from the session and name/phone from the latest booking', async () => {
    expect(store.bookingEmail()).toBe('jane@example.com');
    expect(store.bookingName()).toBe('');

    httpMock
      .match((r) => r.url.includes('/api/v1/customer/appointments'))
      .forEach((r) => r.flush(history));
    await Promise.resolve();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(store.bookingName()).toBe('Jane Smith');
    expect(store.bookingPhone()).toBe('555-0100');
    expect(store.bookingEmail()).toBe('jane@example.com');
  });

  it('never overwrites contact details the customer already typed', async () => {
    store.bookingModel.update((m) => ({ ...m, customerName: 'Janie', customerEmail: 'j@work.io' }));

    httpMock
      .match((r) => r.url.includes('/api/v1/customer/appointments'))
      .forEach((r) => r.flush(history));
    await Promise.resolve();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(store.bookingName()).toBe('Janie');
    expect(store.bookingEmail()).toBe('j@work.io');
    expect(store.bookingPhone()).toBe('555-0100');
  });
});
