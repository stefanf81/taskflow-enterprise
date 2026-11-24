import { Component } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AdminDashboard, REFRESH_THROTTLE_MS } from './admin-dashboard';
import { AppointmentStore } from './appointment.store';
import { FlashMessages } from '../../core/ui/flash-messages';
import { AuthState } from '../../core/auth/auth.state';
import { AdminEventsService } from './admin-events.service';
import { AppointmentDashboardResponse } from '../../types/api';

@Component({ template: 'section' })
class SectionStub {}

const SECTION_PATHS = [
  'appointments',
  'calendar',
  'services',
  'schedules',
  'notifications',
] as const;

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
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(
          SECTION_PATHS.map((path) => ({ path: `admin/${path}`, component: SectionStub })),
        ),
      ],
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

  it('links every section to its own URL and marks the current one', async () => {
    const el = fixture.nativeElement as HTMLElement;
    const links = () =>
      Array.from(el.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Owner sections"] a'));

    expect(links().map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      ['Appointments', '/admin/appointments'],
      ['Calendar', '/admin/calendar'],
      ['Service Catalog', '/admin/services'],
      ['Schedules & Time-Off', '/admin/schedules'],
      ['Notification Outbox', '/admin/notifications'],
    ]);

    await TestBed.inject(Router).navigateByUrl('/admin/schedules');
    fixture.detectChanges();

    const current = links().filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.textContent?.trim())).toEqual(['Schedules & Time-Off']);
    expect(current[0]!.classList).toContain('text-accent');
    // The routed section renders inside the card.
    expect(el.querySelector('main router-outlet + *')?.textContent).toBe('section');
  });

  it('has no Sync DB button and no permanent guidelines card', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Sync DB');
    expect(text).not.toContain('Owner Guidelines');
    // The booking numbers belong to the appointments section, not to the shell.
    expect(text).not.toContain('Total Bookings');
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
    expect(TestBed.inject(FlashMessages).errorMessage()).toBeNull();
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
    expect(TestBed.inject(FlashMessages).errorMessage()).toContain('Could not sign out');
  });

  it('refetches the list on an SSE tick at once and coalesces a burst into one trailing refresh', () => {
    vi.useFakeTimers();
    try {
      const adminEvents = TestBed.inject(AdminEventsService);
      const store = TestBed.inject(AppointmentStore);
      // SSE ticks never cancel a load in flight (see AppointmentStore.refreshWhenIdle).
      const refresh = vi.spyOn(store, 'refreshWhenIdle');

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
