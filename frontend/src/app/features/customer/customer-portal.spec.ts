import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { CustomerPortal } from './customer-portal';
import { AppointmentService } from '../../appointment.service';
import { AppointmentStore } from '../../appointment.store';
import { CustomerStore } from '../../customer.store';

/**
 * TE1: Component-level QA suite for the Customer dashboard.
 * Covers the cancel flow (success + failure surfacing via cancelErrorMessage),
 * the 12-hour time formatter, and logout.
 */
describe('CustomerPortal Component Quality Assurance Suite', () => {
  let fixture: ComponentFixture<CustomerPortal>;
  let component: CustomerPortal;
  let httpMock: HttpTestingController;

  const mockAppointments = {
    content: [
      {
        id: 1,
        publicId: 'pub-1',
        customerName: 'Alice',
        customerEmail: 'alice@example.com',
        customerPhone: '123',
        barberName: 'Alex',
        bookingDate: '2026-08-01',
        bookingTime: '09:00',
        serviceType: 'Classic Haircut',
        status: 'PENDING',
        createdAt: '2026-07-01T00:00:00',
        updatedAt: '2026-07-01T00:00:00',
      },
      {
        id: 2,
        publicId: 'pub-2',
        customerName: 'Bob',
        customerEmail: 'bob@example.com',
        customerPhone: '456',
        barberName: 'Sara',
        bookingDate: '2026-08-02',
        bookingTime: '13:30',
        serviceType: 'Beard Trim',
        status: 'APPROVED',
        createdAt: '2026-07-01T00:00:00',
        updatedAt: '2026-07-01T00:00:00',
      },
    ],
    totalPages: 1,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CustomerPortal],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        AppointmentService,
        AppointmentStore,
        CustomerStore,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CustomerPortal);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    fixture.detectChanges();

    // Flush the initial customer appointments load.
    const req = httpMock.expectOne(
      (r) => r.url.includes('/api/v1/customer/appointments') && r.method === 'GET',
    );
    req.flush(mockAppointments);

    httpMock
      .match((r) => r.url.includes('/api/v1/auth/me'))
      .forEach((r) => r.flush({ username: 'customer', role: 'ROLE_CUSTOMER' }));
    httpMock.match(() => true).forEach((r) => r.flush([]));
  });

  it('should compile and render the customer portal', () => {
    expect(component).toBeTruthy();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('My Appointments');
  });

  it('should expose the loaded appointments', () => {
    expect(component.customerStore.appointments().length).toBe(2);
  });

  it('should cancel an appointment successfully and clear the error', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    component.customerStore.cancelErrorMessage.set('stale error');
    component.customerStore.cancelAppointment(1);

    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/customer/appointments/1'));
    expect(req.request.method).toBe('DELETE');
    req.flush(null);

    fixture.detectChanges();

    // Reload after success.
    const reload = httpMock.expectOne(
      (r) => r.url.includes('/api/v1/customer/appointments') && r.method === 'GET',
    );
    reload.flush(mockAppointments);

    expect(component.customerStore.cancelErrorMessage()).toBeNull();
  });

  it('should surface a cancel failure on the cancel error signal', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    component.customerStore.cancelAppointment(2);

    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/customer/appointments/2'));
    expect(req.request.method).toBe('DELETE');
    req.error(new ProgressEvent('error'), { status: 404, statusText: 'Not Found' });

    expect(component.cancelErrorMessage()).toBeTruthy();
    expect(component.cancelErrorMessage()).not.toBeNull();
  });

  it('should format 24h times into 12h AM/PM', () => {
    expect(component.formatTime12Hour('09:00')).toBe('9:00 AM');
    expect(component.formatTime12Hour('13:30')).toBe('1:30 PM');
    expect(component.formatTime12Hour('12:00')).toBe('12:00 PM');
    expect(component.formatTime12Hour('')).toBe('');
  });

  it('should log the user out and navigate', () => {
    vi.spyOn(component['router'], 'navigateByUrl').mockImplementation(() => Promise.resolve(true));
    component.onLogout();
    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/auth/logout'));
    expect(req.request.method).toBe('POST');
    req.flush(null);
    // On logout the store clears auth state.
    expect(component['store'].isLoggedIn()).toBe(false);
  });
});
