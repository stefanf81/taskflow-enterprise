import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { CustomerPortal } from './customer-portal';
import { AppointmentPage } from '../../types/api';
import { AppointmentsApi } from '../../core/api/appointments-api';
import { AppointmentStore } from '../../core/appointments/appointment.store';
import { CustomerStore } from '../../core/customer/customer.store';
import { AuthState } from '../../core/auth/auth.state';

/**
 * TE1: Component-level QA suite for the Customer dashboard.
 * Covers the cancel flow (success + failure surfacing via cancelErrorMessage),
 * the 12-hour time formatter, and logout.
 */
describe('CustomerPortal Component Quality Assurance Suite', () => {
  let fixture: ComponentFixture<CustomerPortal>;
  let component: CustomerPortal;
  let httpMock: HttpTestingController;

  const mockAppointments: AppointmentPage = {
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
    page: { number: 0, size: 10, totalElements: 2, totalPages: 1 },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CustomerPortal],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        AppointmentsApi,
        AppointmentStore,
        CustomerStore,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CustomerPortal);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    // B2: the CustomerStore resource is gated on auth — log in so the initial
    // appointments fetch fires.
    TestBed.inject(AuthState).applyRole('ROLE_CUSTOMER', 'customer');

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
    component.customerStore.cancelAppointment('test-public-uuid');

    const req = httpMock.expectOne((r) =>
      r.url.includes('/api/v1/customer/appointments/test-public-uuid'),
    );
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
    component.customerStore.cancelAppointment('another-uuid');

    const req = httpMock.expectOne((r) =>
      r.url.includes('/api/v1/customer/appointments/another-uuid'),
    );
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

  it('should log the user out and navigate', async () => {
    const navigate = vi
      .spyOn(component['router'], 'navigateByUrl')
      .mockImplementation(() => Promise.resolve(true));
    const done = component.onLogout();
    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/auth/logout'));
    expect(req.request.method).toBe('POST');
    req.flush(null);
    await done;
    // On logout the store clears auth state and the portal leaves for the landing page.
    expect(TestBed.inject(AuthState).isLoggedIn()).toBe(false);
    expect(navigate).toHaveBeenCalledWith('');
  });

  describe('cancelled bookings and booking entry (CANCELLED, FE-7)', () => {
    const listWith = (status: string, publicId = 'pub-x'): AppointmentPage => ({
      content: [{ ...mockAppointments.content[0]!, id: 9, publicId, status }],
      page: { number: 0, size: 10, totalElements: 1, totalPages: 1 },
    });

    const cancelButtons = () =>
      Array.from(fixture.nativeElement.querySelectorAll('button')).filter((b) =>
        (b as HTMLElement).textContent?.includes('Cancel Booking'),
      );

    const reloadWith = async (page: AppointmentPage) => {
      component.customerStore.loadAppointments();
      fixture.detectChanges();
      httpMock
        .expectOne((r) => r.url.includes('/api/v1/customer/appointments') && r.method === 'GET')
        .flush(page);
      await fixture.whenStable();
      fixture.detectChanges();
    };

    it('shows a Cancelled badge and offers no cancel action for a cancelled booking', async () => {
      await reloadWith(listWith('CANCELLED'));

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Cancelled');
      expect(cancelButtons()).toHaveLength(0);
    });

    it('offers no cancel action for a denied booking either', async () => {
      await reloadWith(listWith('DENIED'));
      expect(cancelButtons()).toHaveLength(0);
    });

    it('still offers cancel for pending and approved bookings', () => {
      fixture.detectChanges();
      expect(cancelButtons()).toHaveLength(2);
    });

    it('links to the booking flow from the header', () => {
      const link = (fixture.nativeElement as HTMLElement).querySelector('a[href="/customer/book"]');
      expect(link?.textContent).toContain('Book an appointment');
    });

    it('shows a retry (not a blank page) when the list fails to load (FE-1)', async () => {
      component.customerStore.loadAppointments();
      fixture.detectChanges();
      httpMock
        .expectOne((r) => r.url.includes('/api/v1/customer/appointments') && r.method === 'GET')
        .flush(null, { status: 500, statusText: 'Server Error' });
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Could not load your appointments. Please retry.');
      expect(el.querySelector('h1')?.textContent).toContain('My Appointments');
    });

    it('stays on the page with an error when logout fails', async () => {
      const navigate = vi
        .spyOn(component['router'], 'navigateByUrl')
        .mockImplementation(() => Promise.resolve(true));

      const done = component.onLogout();
      httpMock
        .expectOne((r) => r.url.includes('/api/v1/auth/logout'))
        .flush(null, { status: 500, statusText: 'Server Error' });
      await done;
      fixture.detectChanges();

      expect(navigate).not.toHaveBeenCalled();
      expect(TestBed.inject(AuthState).isLoggedIn()).toBe(true);
      expect(component.errorMessage()).toContain('Could not sign out');
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Could not sign out');
    });
  });
});
