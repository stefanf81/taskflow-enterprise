import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AdminDashboard } from './admin-dashboard';
import { AppointmentService } from '../../appointment.service';
import { AppointmentStore } from '../../appointment.store';
import { BarberStore } from '../../barber.store';
import { NotificationStore } from '../../notification.store';
import { CustomerStore } from '../../customer.store';

/**
 * TE1: Component-level QA suite for the Owner (admin) dashboard.
 * Covers approval / denial / deletion, status filtering, pagination math,
 * the 12-hour time formatter, and that action failures surface on the
 * errorMessage signal (C-level error surfacing).
 */
describe('AdminDashboard Component Quality Assurance Suite', () => {
  let fixture: ComponentFixture<AdminDashboard>;
  let component: AdminDashboard;
  let httpMock: HttpTestingController;

  const mockDashboard = {
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
      totalPages: 3,
      totalElements: 6,
      size: 50,
      number: 0,
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
      imports: [AdminDashboard],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        AppointmentService,
        AppointmentStore,
        BarberStore,
        NotificationStore,
        CustomerStore,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminDashboard);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    TestBed.inject(AppointmentStore).isLoggedIn.set(true);

    fixture.detectChanges();

    // Flush the initial dashboard load.
    const req = httpMock.expectOne(
      (r) => r.url.includes('/api/v1/appointments') && r.method === 'GET',
    );
    req.flush(mockDashboard);

    // The store also triggers a /auth/me when isLoggedIn is true; in the default
    // test state we leave it logged out, so flush any auth request that appears.
    httpMock
      .match((r) => r.url.includes('/api/v1/auth/me'))
      .forEach((r) => r.flush({ username: 'admin', role: 'ROLE_ADMIN' }));
    httpMock.match(() => true).forEach((r) => r.flush([]));
  });

  it('should compile and render the owner panel', () => {
    expect(component).toBeTruthy();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain(
      'TaskFlow Owner Panel',
    );
  });

  it('should expose the loaded appointments and stats', () => {
    expect(component.appointments().length).toBe(2);
    expect(component.stats().total).toBe(6);
    expect(component.totalPages()).toBe(3);
  });

  it('should approve an appointment and reload the list', () => {
    component.approveAppointment(1);
    const req = httpMock.expectOne((r) => r.url.endsWith('/api/v1/appointments/1'));
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ status: 'APPROVED' });
    req.flush({ ...mockDashboard.page.content[0], status: 'APPROVED' });

    fixture.detectChanges();

    // Subsequent list reload.
    const reload = httpMock.expectOne(
      (r) => r.url.includes('/api/v1/appointments') && r.method === 'GET',
    );
    reload.flush(mockDashboard);
    expect(component.successMessage()).toBeTruthy();
    expect(component.successMessage()?.toLowerCase()).toContain('approved');
  });

  it('should deny an appointment and surface an error on failure', () => {
    component.denyAppointment(2);
    const req = httpMock.expectOne((r) => r.url.endsWith('/api/v1/appointments/2'));
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ status: 'DENIED' });
    req.error(new ProgressEvent('error'), { status: 500, statusText: 'Server Error' });

    expect(component.errorMessage()).toBe('Failed to decline appointment.');
  });

  it('should delete an appointment after confirmation and fail gracefully', () => {
    // Stub window.confirm to accept.
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    component.deleteAppointment(1);
    const req = httpMock.expectOne((r) => r.url.endsWith('/api/v1/appointments/1'));
    expect(req.request.method).toBe('DELETE');
    req.error(new ProgressEvent('error'), { status: 404, statusText: 'Not Found' });

    expect(component.errorMessage()).toBe('Failed to delete booking.');
  });

  it('should apply status filters and reset pagination to page 0', () => {
    component.setFilter('approved');
    expect(component.selectedFilter()).toBe('approved');
    expect(component.currentPage()).toBe(0);

    fixture.detectChanges();

    const req = httpMock.expectOne(
      (r) => r.url.includes('/api/v1/appointments') && r.url.includes('status=APPROVED'),
    );
    expect(req.request.url).toContain('status=APPROVED');
    req.flush(mockDashboard);
  });

  it('should compute pagination boundaries correctly', () => {
    component.currentPage.set(0);
    expect(component.currentPage()).toBe(0);
    component.setPage(-1); // clamped: no-op below 0
    expect(component.currentPage()).toBe(0);

    component.setPage(2);
    expect(component.currentPage()).toBe(2);
    component.setPage(5); // beyond totalPages (3) -> clamped, no change
    expect(component.currentPage()).toBe(2);
  });

  it('should format 24h times into 12h AM/PM', () => {
    expect(component.formatTime12Hour('09:00')).toBe('9:00 AM');
    expect(component.formatTime12Hour('13:30')).toBe('1:30 PM');
    expect(component.formatTime12Hour('12:00')).toBe('12:00 PM');
    expect(component.formatTime12Hour('')).toBe('');
  });

  it('should flag past booking dates as overdue', () => {
    expect(component.isOverdue({ bookingDate: '2020-01-01' } as any)).toBe(true);
    expect(component.isOverdue({ bookingDate: '2099-01-01' } as any)).toBe(false);
    expect(component.isOverdue({} as any)).toBe(false);
  });

  it('should surface a time-off write error on the action error signal', () => {
    const barberStore = TestBed.inject(BarberStore);
    component.setAdminView('schedules');
    barberStore.selectBarber(1);

    component.newTimeOffStartDate.set('2026-09-01');
    component.newTimeOffEndDate.set('2026-09-05');
    component.addTimeOff();

    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/barbers/1/time-off'));
    expect(req.request.method).toBe('POST');
    req.error(new ProgressEvent('error'), { status: 400, statusText: 'Bad Request' });

    expect(barberStore.actionErrorMessage()).toBeTruthy();
    expect(barberStore.actionErrorMessage()).not.toBeNull();
  });
});
