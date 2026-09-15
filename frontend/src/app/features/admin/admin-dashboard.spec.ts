import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AdminDashboard } from './admin-dashboard';
import { AppointmentStore } from '../../appointment.store';
import { AuthState } from '../../auth.state';
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

    TestBed.inject(AuthState).isLoggedIn.set(true);
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

  it('logs out and returns to the landing page', () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    component.onLogout();

    httpMock.match((r) => r.url.includes('/api/v1/auth/logout')).forEach((r) => r.flush(null));
    expect(navigate).toHaveBeenCalledWith('');
    expect(TestBed.inject(AppointmentStore).errorMessage()).toBeNull();
  });
});
