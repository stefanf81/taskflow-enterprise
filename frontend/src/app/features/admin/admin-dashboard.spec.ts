import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AdminDashboard, REFRESH_THROTTLE_MS } from './admin-dashboard';
import { AppointmentStore } from '../../appointment.store';
import { AuthState } from '../../auth.state';
import { AdminEventsService } from '../../admin-events.service';
import { AppointmentDashboardResponse } from '../../types/api';

describe('AdminDashboard shell', () => {
  let fixture: ComponentFixture<AdminDashboard>;
  let component: AdminDashboard;
  let httpMock: HttpTestingController;

  const mockDashboard: AppointmentDashboardResponse = {
    page: {
      content: [],
      page: { number: 0, size: 50, totalElements: 0, totalPages: 1 },
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
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminDashboard);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    TestBed.inject(AuthState).applyRole('ROLE_ADMIN', 'admin');
    fixture.detectChanges();

    httpMock
      .match((r) => r.url.includes('/api/v1/appointments') && r.method === 'GET')
      .forEach((r) => r.flush(mockDashboard));
    httpMock
      .match((r) => r.url.includes('/api/v1/auth/me'))
      .forEach((r) => r.flush({ username: 'admin', role: 'ROLE_ADMIN' }));
  });

  it('renders the owner panel chrome', () => {
    expect(component).toBeTruthy();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain(
      'TaskFlow Owner Panel',
    );
  });

  it('switches between workspace tabs', () => {
    expect(component.adminView()).toBe('appointments');
    component.setAdminView('schedules');
    expect(component.adminView()).toBe('schedules');
    component.setAdminView('notifications');
    expect(component.adminView()).toBe('notifications');
  });

  it('exposes dashboard stats from the store', () => {
    expect(component.stats().total).toBe(6);
  });

  it('logs out and returns to the landing page once the server confirms', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const done = component.onLogout();
    // Still signed in (and still here) while the request is in flight.
    expect(TestBed.inject(AuthState).isLoggedIn()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();

    httpMock.match((r) => r.url.includes('/api/v1/auth/logout')).forEach((r) => r.flush(null));
    await done;

    expect(navigate).toHaveBeenCalledWith('');
    expect(TestBed.inject(AuthState).isLoggedIn()).toBe(false);
    expect(TestBed.inject(AppointmentStore).errorMessage()).toBeNull();
  });

  it('stays on the dashboard and shows an error when logout fails', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const done = component.onLogout();
    httpMock
      .match((r) => r.url.includes('/api/v1/auth/logout'))
      .forEach((r) => r.flush(null, { status: 500, statusText: 'Server Error' }));
    await done;

    expect(navigate).not.toHaveBeenCalled();
    expect(TestBed.inject(AuthState).isLoggedIn()).toBe(true);
    expect(TestBed.inject(AppointmentStore).errorMessage()).toContain('Could not sign out');
  });

  it('shows a retry instead of a board of zeros when the dashboard fails to load', async () => {
    const store = TestBed.inject(AppointmentStore);
    store.refresh();
    fixture.detectChanges();
    httpMock
      .match((r) => r.url.includes('/api/v1/appointments') && r.method === 'GET')
      .forEach((r) => r.flush(null, { status: 500, statusText: 'Server Error' }));
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Could not load appointments. Please retry.');
    expect(el.textContent).not.toContain('Total Bookings');
    // The shell kept rendering (a raw resource.value() read would have thrown).
    expect(el.querySelector('h1')?.textContent).toContain('TaskFlow Owner Panel');

    component.retryLoad();
    fixture.detectChanges();
    httpMock
      .match((r) => r.url.includes('/api/v1/appointments') && r.method === 'GET')
      .forEach((r) => r.flush(mockDashboard));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('Total Bookings');
  });

  it('refetches the list on an SSE tick at once and coalesces a burst into one trailing refresh', () => {
    vi.useFakeTimers();
    try {
      const adminEvents = TestBed.inject(AdminEventsService);
      const store = TestBed.inject(AppointmentStore);
      const refresh = vi.spyOn(store, 'refresh');

      adminEvents['appointmentChangesSubject'].next();
      expect(refresh).toHaveBeenCalledTimes(1);

      adminEvents['appointmentChangesSubject'].next();
      adminEvents['appointmentChangesSubject'].next();
      adminEvents['appointmentChangesSubject'].next();
      expect(refresh).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(REFRESH_THROTTLE_MS);
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the live stream when the dashboard is destroyed', () => {
    const adminEvents = TestBed.inject(AdminEventsService);
    const close = vi.spyOn(adminEvents, 'close');

    fixture.destroy();

    expect(close).toHaveBeenCalled();
  });
});
