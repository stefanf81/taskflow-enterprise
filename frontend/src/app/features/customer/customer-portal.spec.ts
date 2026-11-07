import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { CustomerPortal } from './customer-portal';
import { AppointmentPage } from '../../types/api';
import { AppointmentsApi } from '../../core/api/appointments-api';
import { CustomerStore } from '../../core/customer/customer.store';
import { AuthState } from '../../core/auth/auth.state';
import { ShopClock } from '../../core/shop-clock';
import { FlashMessages } from '../../core/ui/flash-messages';
import { DEFAULT_SHOP_RULES } from '@taskflow/domain';

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
        CustomerStore,
        // Mid-July 2026 on the shop's clock: the fixture's August bookings are still upcoming.
        {
          provide: ShopClock,
          useValue: { now: () => new Date(2026, 6, 15, 12, 0), rules: () => DEFAULT_SHOP_RULES },
        },
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

  describe('reschedule and calendar export', () => {
    const buttonWith = (text: string): HTMLButtonElement =>
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === text,
      ) as HTMLButtonElement;

    const availabilityOf = (publicId: string) =>
      httpMock.expectOne((r) =>
        r.url.endsWith(`/api/v1/customer/appointments/${publicId}/availability`),
      );

    it('offers the open slots of the booking and moves it', async () => {
      fixture.detectChanges();
      // The first booking's button (Alice with Alex).
      buttonWith('Reschedule').click();
      fixture.detectChanges();

      // Today (Wed 15 July, 12:00) is the first open day; the slots the server refuses for this
      // booking (its barber and booked length) are excluded.
      const busy = availabilityOf('pub-1');
      expect(busy.request.method).toBe('GET');
      expect(busy.request.params.get('bookingDate')).toBe('2026-07-15');
      busy.flush(['13:00']);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(buttonWith('1:00 PM')).toBeUndefined();
      expect(buttonWith('11:00 AM')).toBeUndefined();
      buttonWith('2:00 PM').click();
      fixture.detectChanges();
      buttonWith('Save new time').click();

      const move = httpMock.expectOne((r) =>
        r.url.endsWith('/api/v1/customer/appointments/pub-1/reschedule'),
      );
      expect(move.request.method).toBe('PUT');
      expect(move.request.body).toEqual({ bookingDate: '2026-07-15', bookingTime: '14:00' });
      move.flush({
        ...mockAppointments.content[0]!,
        bookingDate: '2026-07-15',
        bookingTime: '14:00',
      });
      fixture.detectChanges();
      httpMock
        .expectOne((r) => r.url.includes('/api/v1/customer/appointments') && r.method === 'GET')
        .flush(mockAppointments);
      await fixture.whenStable();

      expect(TestBed.inject(FlashMessages).successMessage()).toContain('Appointment moved');
      expect(component['reschedulingPublicId']()).toBeNull();
    });

    it('shows why the availability could not be loaded', async () => {
      component['openReschedule']('pub-1');
      fixture.detectChanges();
      availabilityOf('pub-1').flush(
        { message: 'Only future pending or approved appointments can be rescheduled.' },
        { status: 409, statusText: 'Conflict' },
      );
      await fixture.whenStable();
      fixture.detectChanges();

      const alert = (fixture.nativeElement as HTMLElement).querySelector(
        'app-reschedule-picker [role="alert"]',
      );
      expect(alert?.textContent).toContain(
        'Only future pending or approved appointments can be rescheduled.',
      );
      expect(buttonWith('Retry')).toBeDefined();
    });

    it('reports a refused move on the banner and keeps the picker open', async () => {
      component['openReschedule']('pub-1');
      fixture.detectChanges();
      availabilityOf('pub-1').flush([]);
      await fixture.whenStable();
      fixture.detectChanges();

      buttonWith('3:00 PM').click();
      fixture.detectChanges();
      buttonWith('Save new time').click();
      httpMock
        .expectOne((r) => r.url.endsWith('/api/v1/customer/appointments/pub-1/reschedule'))
        .flush(
          { message: 'The selected slot is already booked or unavailable.' },
          { status: 409, statusText: 'x' },
        );
      await fixture.whenStable();

      expect(TestBed.inject(FlashMessages).errorMessage()).toBe(
        'The selected slot is already booked or unavailable.',
      );
      expect(component['reschedulingPublicId']()).toBe('pub-1');
    });

    it('reports a failed calendar export instead of failing silently', () => {
      component.customerStore.exportCalendar('pub-2');
      httpMock
        .expectOne((r) => r.url.endsWith('/api/v1/customer/appointments/pub-2/calendar'))
        .flush(null, { status: 500, statusText: 'x' });

      expect(TestBed.inject(FlashMessages).errorMessage()).toBe(
        'Failed to export the calendar file. Please try again.',
      );
      expect(component.customerStore.exportingId()).toBeNull();
    });
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

    it('offers no cancel once a booking has started, as the server refuses it then', () => {
      TestBed.inject(ShopClock).now = () => new Date(2026, 7, 2, 18, 0);
      fixture.detectChanges();
      expect(cancelButtons()).toHaveLength(0);
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
