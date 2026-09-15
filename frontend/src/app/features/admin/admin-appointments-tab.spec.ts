import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AdminAppointmentsTab } from './admin-appointments-tab';
import { AppointmentStore } from '../../appointment.store';
import { AuthState } from '../../auth.state';
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
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminAppointmentsTab);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    TestBed.inject(AuthState).isLoggedIn.set(true);
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

    const store = TestBed.inject(AppointmentStore);
    expect(store.successMessage()?.toLowerCase()).toContain('approved');
  });

  it('should deny an appointment and surface an error on failure', () => {
    component.denyAppointment(2);
    const req = httpMock.expectOne((r) => r.url.endsWith('/api/v1/appointments/2'));
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ status: 'DENIED' });
    req.error(new ProgressEvent('error'), { status: 500, statusText: 'Server Error' });

    expect(TestBed.inject(AppointmentStore).errorMessage()).toBe('Failed to decline appointment.');
  });

  it('should delete an appointment after confirmation and fail gracefully', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    component.deleteAppointment(1);
    const req = httpMock.expectOne((r) => r.url.endsWith('/api/v1/appointments/1'));
    expect(req.request.method).toBe('DELETE');
    req.error(new ProgressEvent('error'), { status: 404, statusText: 'Not Found' });

    expect(TestBed.inject(AppointmentStore).errorMessage()).toBe('Failed to delete booking.');
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
});
