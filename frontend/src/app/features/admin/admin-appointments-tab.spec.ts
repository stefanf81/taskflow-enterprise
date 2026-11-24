import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AdminAppointmentsTab } from './admin-appointments-tab';
import { AppointmentStore } from './appointment.store';
import { FlashMessages } from '../../core/ui/flash-messages';
import { AuthState } from '../../core/auth/auth.state';
import { ShopClock } from '../../core/shop-clock';
import { AppointmentsApi } from '../../core/api/appointments-api';
import { AppointmentDashboardResponse } from '../../types/api';

describe('AdminAppointmentsTab', () => {
  let fixture: ComponentFixture<AdminAppointmentsTab>;
  let component: AdminAppointmentsTab;
  let httpMock: HttpTestingController;

  const mockDashboard: AppointmentDashboardResponse = {
    page: {
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
      page: { number: 0, size: 50, totalElements: 101, totalPages: 3 },
    },
    stats: {
      total: 6,
      pending: 1,
      approved: 1,
      denied: 0,
      overdue: 0,
      progress: 50,
      approvedRevenue: 0,
    },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminAppointmentsTab],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        AppointmentsApi,
        AppointmentStore,
        { provide: ShopClock, useValue: { now: () => new Date() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminAppointmentsTab);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    TestBed.inject(AuthState).applyRole('ROLE_ADMIN', 'admin');
    fixture.detectChanges();

    httpMock
      .expectOne((r) => r.url.includes('/api/v1/appointments') && r.method === 'GET')
      .flush(mockDashboard);
    httpMock
      .match((r) => r.url.includes('/api/v1/auth/me'))
      .forEach((r) => r.flush({ username: 'admin', role: 'ROLE_ADMIN' }));
  });

  it('should expose the loaded appointments and pagination metadata', () => {
    expect(component.appointments().length).toBe(2);
    expect(component.totalPages()).toBe(3);
  });

  it('should approve an appointment and reload the list', () => {
    component.approveAppointment(1);
    const req = httpMock.expectOne((r) => r.url.endsWith('/api/v1/appointments/1'));
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ status: 'APPROVED' });
    req.flush({ ...mockDashboard.page.content[0], status: 'APPROVED' });

    fixture.detectChanges();

    const reload = httpMock.expectOne(
      (r) => r.url.includes('/api/v1/appointments') && r.method === 'GET',
    );
    reload.flush(mockDashboard);

    expect(TestBed.inject(FlashMessages).successMessage()?.toLowerCase()).toContain('approved');
  });

  it('keeps the rows on screen while a refresh is in flight', () => {
    TestBed.inject(AppointmentStore).refresh();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Loading appointments');
    expect(text).toContain('Alice');

    httpMock
      .expectOne((r) => r.url.includes('/api/v1/appointments') && r.method === 'GET')
      .flush(mockDashboard);
  });

  it('should deny an appointment and surface an error on failure', () => {
    component.denyAppointment(2);
    const req = httpMock.expectOne((r) => r.url.endsWith('/api/v1/appointments/2'));
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ status: 'DENIED' });
    req.error(new ProgressEvent('error'), { status: 500, statusText: 'Server Error' });

    expect(TestBed.inject(FlashMessages).errorMessage()).toBe('Failed to decline appointment.');
  });

  it('should cancel an appointment after confirmation and fail gracefully', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    component.cancelAppointment(1);
    const req = httpMock.expectOne((r) => r.url.endsWith('/api/v1/appointments/1'));
    expect(req.request.method).toBe('DELETE');
    req.error(new ProgressEvent('error'), { status: 404, statusText: 'Not Found' });

    expect(TestBed.inject(FlashMessages).errorMessage()).toBe('Failed to cancel booking.');
  });

  it('should apply status filters and reset pagination to page 0', () => {
    component.setFilter('approved');
    expect(component.selectedFilter()).toBe('approved');
    expect(component.currentPage()).toBe(0);

    fixture.detectChanges();

    const req = httpMock.expectOne(
      (r) => r.url.includes('/api/v1/appointments') && r.url.includes('status=APPROVED'),
    );
    req.flush(mockDashboard);
  });

  it('should render and navigate pagination controls with nested metadata', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    const buttons = () =>
      fixture.nativeElement.querySelectorAll('.btn-page') as NodeListOf<HTMLButtonElement>;
    expect(buttons().length).toBe(2);
    expect(buttons()[0]!.disabled).toBe(true);
    expect(buttons()[1]!.disabled).toBe(false);

    for (const number of [1, 2]) {
      buttons()[1]!.click();
      fixture.detectChanges();
      httpMock.expectOne(`/api/v1/appointments?page=${number}&size=50`).flush({
        ...mockDashboard,
        page: { ...mockDashboard.page, page: { ...mockDashboard.page.page, number } },
      } satisfies AppointmentDashboardResponse);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component.currentPage()).toBe(number);
    }
  });

  it('should format 24h times into 12h AM/PM', () => {
    expect(component.formatTime12Hour('09:00')).toBe('9:00 AM');
    expect(component.formatTime12Hour('13:30')).toBe('1:30 PM');
    expect(component.formatTime12Hour('12:00')).toBe('12:00 PM');
    expect(component.formatTime12Hour('')).toBe('');
  });

  it('should flag past booking dates as overdue', () => {
    expect(component.isOverdue({ bookingDate: '2020-01-01' })).toBe(true);
    expect(component.isOverdue({ bookingDate: '2099-01-01' })).toBe(false);
    expect(component.isOverdue({})).toBe(false);
  });

  describe('cancelled bookings and errors', () => {
    const withStatus = (status: string): AppointmentDashboardResponse => ({
      ...mockDashboard,
      page: {
        ...mockDashboard.page,
        content: [{ ...mockDashboard.page.content[0]!, status }],
      },
    });

    const reloadWith = async (response: AppointmentDashboardResponse) => {
      component.loadAppointments();
      fixture.detectChanges();
      httpMock
        .expectOne((r) => r.url.includes('/api/v1/appointments') && r.method === 'GET')
        .flush(response);
      await fixture.whenStable();
      fixture.detectChanges();
    };

    const buttonLabels = () =>
      Array.from(fixture.nativeElement.querySelectorAll('button')).map(
        (b) => (b as HTMLElement).textContent?.trim() ?? '',
      );

    it('filters by DENIED and CANCELLED', () => {
      expect(buttonLabels()).toContain('Denied');
      expect(buttonLabels()).toContain('Cancelled');

      component.setFilter('denied');
      fixture.detectChanges();

      httpMock
        .expectOne((r) => r.url.includes('/api/v1/appointments') && r.url.includes('status=DENIED'))
        .flush(mockDashboard);

      component.setFilter('cancelled');
      fixture.detectChanges();

      httpMock
        .expectOne(
          (r) => r.url.includes('/api/v1/appointments') && r.url.includes('status=CANCELLED'),
        )
        .flush(mockDashboard);
    });

    it('shows a Cancelled badge and no approve/deny/cancel actions for a cancelled booking', async () => {
      await reloadWith(withStatus('CANCELLED'));

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('app-status-badge')?.textContent).toContain('Cancelled');
      const labels = buttonLabels();
      expect(labels).not.toContain('Approve');
      expect(labels).not.toContain('Deny');
      expect(el.querySelector('.btn-delete')).toBeNull();
    });

    it('shows the server message when a status change is rejected (409)', () => {
      component.approveAppointment(1);
      httpMock
        .expectOne((r) => r.url.endsWith('/api/v1/appointments/1'))
        .flush(
          { message: 'Cannot approve a cancelled appointment' },
          { status: 409, statusText: 'Conflict' },
        );

      expect(TestBed.inject(FlashMessages).errorMessage()).toBe(
        'Cannot approve a cancelled appointment',
      );
    });

    it('leaves no stale banner when the failure was a 401 (session expiry explains it)', () => {
      component.denyAppointment(2);
      httpMock
        .expectOne((r) => r.url.endsWith('/api/v1/appointments/2'))
        .flush(null, { status: 401, statusText: 'Unauthorized' });

      expect(TestBed.inject(FlashMessages).errorMessage()).toBeNull();
    });

    it('shows a retry instead of an empty list when the load fails (FE-1)', async () => {
      component.loadAppointments();
      fixture.detectChanges();
      httpMock
        .expectOne((r) => r.url.includes('/api/v1/appointments') && r.method === 'GET')
        .flush(null, { status: 500, statusText: 'Server Error' });
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Could not load appointments. Please retry.');
      expect(buttonLabels()).toContain('Retry');
    });

    it('offers a way back from an empty page past the end (no pagination dead end)', async () => {
      TestBed.inject(AppointmentStore).currentPage.set(2);
      fixture.detectChanges();
      httpMock
        .expectOne((r) => r.url.includes('page=2'))
        .flush({
          ...mockDashboard,
          page: { content: [], page: { number: 2, size: 50, totalElements: 100, totalPages: 3 } },
        } satisfies AppointmentDashboardResponse);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(buttonLabels()).toContain('Back to first page');
    });
  });

  describe('bulk approve', () => {
    const base = mockDashboard.page.content[0]!;
    const threePending: AppointmentDashboardResponse = {
      ...mockDashboard,
      page: {
        ...mockDashboard.page,
        content: [
          { ...base, id: 11, customerName: 'Carol' },
          { ...base, id: 12, customerName: 'Dave' },
          { ...base, id: 13, customerName: 'Erin' },
          { ...base, id: 14, customerName: 'Frank', status: 'APPROVED' },
        ],
      },
    };
    const el = () => fixture.nativeElement as HTMLElement;
    const boxes = () =>
      Array.from(el().querySelectorAll<HTMLInputElement>('li.appt-row input[type="checkbox"]'))
        // the phone and the desktop checkbox of a row: count the desktop ones (one per row)
        .filter((box) => !box.classList.contains('md:hidden'));
    const bar = () => el().querySelector('[aria-live="polite"]')?.textContent?.trim();
    const approveButton = () => el().querySelector<HTMLButtonElement>('button.ml-auto');
    const statusPuts = () =>
      httpMock.match((r) => /\/api\/v1\/appointments\/\d+$/.test(r.url) && r.method === 'PUT');

    beforeEach(async () => {
      component.loadAppointments();
      fixture.detectChanges();
      httpMock
        .expectOne((r) => r.url.includes('/api/v1/appointments') && r.method === 'GET')
        .flush(threePending);
      await fixture.whenStable();
      fixture.detectChanges();
    });

    it('lets only pending bookings be ticked, and counts them', () => {
      // Three pending rows have a box; the approved one has none.
      expect(boxes().filter((box) => box.getAttribute('aria-label')).length).toBe(3);
      expect(bar()).toBe('0 selected');
      expect(approveButton()?.disabled).toBe(true);

      boxes()[0]!.click();
      fixture.detectChanges();
      expect(bar()).toBe('1 selected');
      expect(approveButton()?.disabled).toBe(false);
    });

    it('selects and clears every pending booking on the page at once', () => {
      const all = el().querySelector<HTMLInputElement>('label input[type="checkbox"]')!;
      all.click();
      fixture.detectChanges();
      expect(bar()).toBe('3 selected');
      expect(all.checked).toBe(true);

      all.click();
      fixture.detectChanges();
      expect(bar()).toBe('0 selected');
    });

    it('approves the ticked bookings one request each and reports the count', async () => {
      el().querySelector<HTMLInputElement>('label input[type="checkbox"]')!.click();
      fixture.detectChanges();
      approveButton()!.click();
      fixture.detectChanges();

      const puts = statusPuts();
      expect(puts.map((r) => r.request.url.split('/').pop()).sort()).toEqual(['11', '12', '13']);
      expect(puts.every((r) => r.request.body.status === 'APPROVED')).toBe(true);
      expect(approveButton()?.textContent).toContain('Approving');
      puts.forEach((r) => r.flush({ ...base, status: 'APPROVED' }));
      await new Promise((resolve) => setTimeout(resolve));
      fixture.detectChanges();

      httpMock
        .expectOne((r) => r.url.includes('/api/v1/appointments') && r.method === 'GET')
        .flush(mockDashboard);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(TestBed.inject(FlashMessages).successMessage()).toContain('3 appointments APPROVED');
      expect(TestBed.inject(FlashMessages).errorMessage()).toBeNull();
    });

    it('goes on after one failure and says how many were approved', async () => {
      el().querySelector<HTMLInputElement>('label input[type="checkbox"]')!.click();
      fixture.detectChanges();
      approveButton()!.click();

      const puts = statusPuts();
      puts.forEach((r) =>
        r.request.url.endsWith('/12')
          ? r.flush({ message: 'Slot already taken' }, { status: 409, statusText: 'Conflict' })
          : r.flush({ ...base, status: 'APPROVED' }),
      );
      await new Promise((resolve) => setTimeout(resolve));
      fixture.detectChanges();
      httpMock
        .expectOne((r) => r.url.includes('/api/v1/appointments') && r.method === 'GET')
        .flush(threePending);
      await fixture.whenStable();
      fixture.detectChanges();

      const flash = TestBed.inject(FlashMessages);
      expect(flash.errorMessage()).toContain('Approved 2 of 3; 1 could not be approved.');
      expect(flash.successMessage()).toBeNull();
      expect(bar()).toBe('0 selected');
    });

    it('forgets a ticked booking that is no longer pending after a refresh', async () => {
      boxes()[0]!.click();
      fixture.detectChanges();
      expect(bar()).toBe('1 selected');

      component.loadAppointments();
      fixture.detectChanges();
      httpMock
        .expectOne((r) => r.url.includes('/api/v1/appointments') && r.method === 'GET')
        .flush({
          ...threePending,
          page: {
            ...threePending.page,
            content: threePending.page.content.map((a) =>
              a.id === 11 ? { ...a, status: 'DENIED' as const } : a,
            ),
          },
        });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(bar()).toBe('0 selected');
    });
  });
});
