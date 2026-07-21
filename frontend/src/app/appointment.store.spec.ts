import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, inject } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AppointmentStore } from './appointment.store';
import { AppointmentService } from './appointment.service';

@Component({ standalone: true, template: '' })
class TestHost {
  readonly store = inject(AppointmentStore);
}

describe('AppointmentStore', () => {
  let store: AppointmentStore;
  let httpMock: HttpTestingController;
  let fixture: ComponentFixture<TestHost>;

  const mockDashboard = {
    page: {
      content: [
        {
          id: 1, publicId: 'pub-1', customerName: 'Alice', customerEmail: 'alice@example.com',
          customerPhone: '123', barberName: 'Alex', bookingDate: '2026-08-01', bookingTime: '09:00',
          serviceType: 'Classic Haircut', status: 'PENDING', createdAt: '2026-07-01T00:00:00', updatedAt: '2026-07-01T00:00:00',
        },
      ],
      totalPages: 3, totalElements: 6, size: 50, number: 0,
    },
    stats: { total: 6, pending: 1, approved: 1, denied: 0, overdue: 0, progress: 50, approvedRevenue: 0 },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [provideHttpClient(), provideHttpClientTesting(), AppointmentService, AppointmentStore],
    });

    fixture = TestBed.createComponent(TestHost);
    store = fixture.componentInstance.store;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should initialize with default signal values', () => {
    expect(store.isLoggedIn()).toBe(false);
    expect(store.currentPage()).toBe(0);
    expect(store.selectedFilter()).toBe('all');
    expect(store.searchQuery()).toBe('');
    expect(store.appointments()).toEqual([]);
    expect(store.totalPages()).toBe(1);
    expect(store.totalElements()).toBe(0);
    expect(store.errorMessage()).toBeNull();
    expect(store.successMessage()).toBeNull();
    expect(store.isSubmitting()).toBe(false);
    expect(store.isCheckingSlots()).toBe(false);
    expect(store.busySlots()).toEqual([]);
  });

  it('should load appointments when logged in', async () => {
    store.isLoggedIn.set(true);
    fixture.detectChanges();

    const req = httpMock.expectOne(
      (r) => r.url.includes('/api/v1/appointments') && r.method === 'GET',
    );
    req.flush(mockDashboard);

    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.appointments().length).toBe(1);
    expect(store.appointments()[0].customerName).toBe('Alice');
    expect(store.stats().total).toBe(6);
    expect(store.totalPages()).toBe(3);
  });

  it('should expose computed stats with default fallback when not logged in', () => {
    expect(store.stats().total).toBe(0);
    expect(store.stats().pending).toBe(0);
  });

  it('should handle onLogout by calling the logout API and clearing state', () => {
    store.isLoggedIn.set(true);
    fixture.detectChanges();
    httpMock.match(() => true).forEach((r) => r.flush(mockDashboard));
    fixture.detectChanges();

    store.onLogout();

    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/auth/logout'));
    expect(req.request.method).toBe('POST');
    req.flush(null);

    expect(store.isLoggedIn()).toBe(false);
  });

  it('should call onLogout that resets state even on API failure', () => {
    store.isLoggedIn.set(true);
    store.onLogout();

    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/auth/logout'));
    req.error(new ProgressEvent('error'), { status: 500, statusText: 'Server Error' });

    expect(store.isLoggedIn()).toBe(false);
  });

  it('should reset auth state via resetAuthState', () => {
    store.isLoggedIn.set(true);
    store.errorMessage.set('Some error');
    store.resetAuthState();

    expect(store.isLoggedIn()).toBe(false);
    expect(store.errorMessage()).toBeNull();
  });

  it('should support pagination and update URL accordingly', async () => {
    store.isLoggedIn.set(true);
    fixture.detectChanges();
    httpMock.expectOne(() => true).flush(mockDashboard);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(store.totalPages()).toBe(3);

    store.currentPage.set(1);
    fixture.detectChanges();

    const req = httpMock.expectOne(
      (r) => r.url.includes('/api/v1/appointments') && r.method === 'GET',
    );
    expect(req.request.url).toContain('page=1');
    req.flush(mockDashboard);

    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.totalPages()).toBe(3);
  });

  it('should handle search query encoding', () => {
    store.isLoggedIn.set(true);
    fixture.detectChanges();
    httpMock.expectOne(() => true).flush(mockDashboard);
    fixture.detectChanges();

    store.searchQuery.set('Alice Smith');
    fixture.detectChanges();

    const req = httpMock.expectOne(
      (r) => r.url.includes('/api/v1/appointments') && r.method === 'GET',
    );
    expect(req.request.url).toContain('search=Alice%20Smith');
    req.flush(mockDashboard);
  });
});
