import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, inject } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AppointmentStore } from './appointment.store';
import { AppointmentDashboardResponse } from '../../types/api';
import { AppointmentsApi } from '../../core/api/appointments-api';
import { AuthApi } from '../../core/api/auth-api';
import { AuthState } from '../../core/auth/auth.state';

@Component({ standalone: true, template: '' })
class TestHost {
  readonly store = inject(AppointmentStore);
}

describe('AppointmentStore', () => {
  let store: AppointmentStore;
  let authState: AuthState;
  let httpMock: HttpTestingController;
  let fixture: ComponentFixture<TestHost>;

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

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        AppointmentsApi,
        AuthApi,
        AppointmentStore,
      ],
    });

    fixture = TestBed.createComponent(TestHost);
    store = fixture.componentInstance.store;
    authState = TestBed.inject(AuthState);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should initialize with default signal values', () => {
    expect(authState.isLoggedIn()).toBe(false);
    expect(store.currentPage()).toBe(0);
    expect(store.selectedFilter()).toBe('all');
    expect(store.searchQuery()).toBe('');
    expect(store.appointments()).toEqual([]);
    expect(store.totalPages()).toBe(1);
    expect(store.totalElements()).toBe(0);
  });

  it('does not request the admin listing for a signed-in customer (it would only 403)', () => {
    authState.applyRole('ROLE_CUSTOMER', 'customer');
    fixture.detectChanges();

    httpMock.expectNone((r) => r.url.includes('/api/v1/appointments') && r.method === 'GET');
  });

  it('should load appointments when logged in', async () => {
    authState.applyRole('ROLE_ADMIN', 'admin');
    fixture.detectChanges();

    const req = httpMock.expectOne(
      (r) => r.url.includes('/api/v1/appointments') && r.method === 'GET',
    );
    req.flush(mockDashboard);

    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.appointments().length).toBe(1);
    expect(store.appointments()[0]!.customerName).toBe('Alice');
    expect(store.stats().total).toBe(6);
    expect(store.totalPages()).toBe(3);
    expect(store.totalElements()).toBe(101);
  });

  it('should expose computed stats with default fallback when not logged in', () => {
    expect(store.stats().total).toBe(0);
    expect(store.stats().pending).toBe(0);
  });

  it('should navigate multiple pages and enforce boundaries using nested metadata', async () => {
    authState.applyRole('ROLE_ADMIN', 'admin');
    fixture.detectChanges();
    httpMock.expectOne(() => true).flush(mockDashboard);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(store.totalPages()).toBe(3);

    store.prevPage();
    expect(store.currentPage()).toBe(0);

    for (const number of [1, 2]) {
      store.nextPage();
      fixture.detectChanges();

      const content = [{ ...mockDashboard.page.content[0]!, id: number + 1 }];
      httpMock.expectOne(`/api/v1/appointments?page=${number}&size=50`).flush({
        ...mockDashboard,
        page: { content, page: { ...mockDashboard.page.page, number } },
      } satisfies AppointmentDashboardResponse);

      await fixture.whenStable();
      fixture.detectChanges();

      expect(store.currentPage()).toBe(number);
      expect(store.appointments()).toEqual(content);
      expect(store.totalPages()).toBe(3);
      expect(store.totalElements()).toBe(101);
    }

    store.nextPage();
    expect(store.currentPage()).toBe(2);
    fixture.detectChanges();
    httpMock.expectNone((r) => r.url.includes('/api/v1/appointments'));

    store.prevPage();
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/appointments?page=1&size=50').flush({
      ...mockDashboard,
      page: { ...mockDashboard.page, page: { ...mockDashboard.page.page, number: 1 } },
    } satisfies AppointmentDashboardResponse);
    await fixture.whenStable();
    expect(store.currentPage()).toBe(1);
  });

  it('should debounce search and encode the query in the URL (B1)', async () => {
    authState.applyRole('ROLE_ADMIN', 'admin');
    fixture.detectChanges();
    httpMock.expectOne(() => true).flush(mockDashboard);
    fixture.detectChanges();

    vi.useFakeTimers();
    try {
      store.onSearchChange('Alice Smith');

      // No request fires while the 300ms debounce window is still open.
      fixture.detectChanges();
      expect(httpMock.match((r) => r.url.includes('search='))).toHaveLength(0);

      // Elapse the window -> searchDebounced updates -> resource refetches once.
      vi.advanceTimersByTime(300);
      await Promise.resolve(); // flush the resource effect microtask
      fixture.detectChanges();

      const req = httpMock.expectOne(
        (r) => r.url.includes('/api/v1/appointments') && r.method === 'GET',
      );
      expect(req.request.url).toContain('search=Alice%20Smith');
      expect(req.request.url).toContain('page=0');
      req.flush(mockDashboard);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should set the search query immediately and debounce the fetch (B1)', () => {
    store.onSearchChange('Bob');
    expect(store.searchQuery()).toBe('Bob');
    expect(store.searchDebounced()).toBe('');
  });

  it('should reset page to 0 on filter change (B1)', () => {
    store.currentPage.set(2);
    store.setFilter('approved');
    expect(store.selectedFilter()).toBe('approved');
    expect(store.currentPage()).toBe(0);
  });

  describe('error-safe lists (FE-1)', () => {
    it('keeps every list signal readable after a failed load', async () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      fixture.detectChanges();
      httpMock
        .expectOne((r) => r.url.includes('/api/v1/appointments'))
        .error(new ProgressEvent('error'), { status: 500, statusText: 'Server Error' });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(store.loadErrorMessage()).toBe('Could not load appointments. Please retry.');
      expect(() => store.appointments()).not.toThrow();
      expect(store.appointments()).toEqual([]);
      expect(store.stats().total).toBe(0);
      expect(store.totalPages()).toBe(1);
      expect(store.totalElements()).toBe(0);
    });

    it('recovers when a retry succeeds after a failure', async () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      fixture.detectChanges();
      httpMock
        .expectOne((r) => r.url.includes('/api/v1/appointments'))
        .error(new ProgressEvent('error'), { status: 500, statusText: 'Server Error' });
      await fixture.whenStable();

      store.refresh();
      fixture.detectChanges();
      httpMock.expectOne((r) => r.url.includes('/api/v1/appointments')).flush(mockDashboard);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(store.loadErrorMessage()).toBeNull();
      expect(store.stats().total).toBe(6);
    });
  });

  describe('refresh never drops an update (FE-6)', () => {
    it('restarts a load that is already in flight instead of ignoring the second refresh', async () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      fixture.detectChanges();
      const first = httpMock.expectOne((r) => r.url.includes('/api/v1/appointments'));

      // reload() alone is a no-op while this first load is still running.
      store.refresh();
      fixture.detectChanges();

      const open = httpMock.match((r) => r.url.includes('/api/v1/appointments'));
      expect(first.cancelled).toBe(true);
      expect(open.filter((r) => !r.cancelled)).toHaveLength(1);
      open.filter((r) => !r.cancelled).forEach((r) => r.flush(mockDashboard));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(store.stats().total).toBe(6);
    });

    it('refetches a settled list on refresh', async () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      fixture.detectChanges();
      httpMock.expectOne((r) => r.url.includes('/api/v1/appointments')).flush(mockDashboard);
      await fixture.whenStable();

      store.loadAppointments();
      fixture.detectChanges();

      httpMock.expectOne((r) => r.url.includes('/api/v1/appointments')).flush(mockDashboard);
    });
  });

  describe('refreshWhenIdle never cancels a running load', () => {
    const isListing = (r: { url: string }) => r.url.includes('/api/v1/appointments');
    /** Runs the resource effects; whenStable would wait for the follow-up request itself. */
    const settle = async () => {
      fixture.detectChanges();
      await Promise.resolve();
      fixture.detectChanges();
    };

    it('lets the load in flight finish, then loads exactly once more', async () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      fixture.detectChanges();
      const first = httpMock.expectOne(isListing);

      // a burst of events while the first load is still running
      store.refreshWhenIdle();
      store.refreshWhenIdle();
      store.refreshWhenIdle();
      await settle();
      expect(first.cancelled).toBe(false);
      expect(httpMock.match(isListing)).toHaveLength(0);

      first.flush(mockDashboard);
      await settle();

      const followUp = httpMock.expectOne(isListing);
      followUp.flush(mockDashboard);
      await fixture.whenStable();
      fixture.detectChanges();
      expect(store.stats().total).toBe(6);
    });

    it('also follows a failed load with one more attempt', async () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      fixture.detectChanges();
      const first = httpMock.expectOne(isListing);

      store.refreshWhenIdle();
      first.error(new ProgressEvent('error'), { status: 500, statusText: 'Server Error' });
      await settle();

      httpMock.expectOne(isListing).flush(mockDashboard);
      await fixture.whenStable();
      fixture.detectChanges();
      expect(store.loadErrorMessage()).toBeNull();
    });

    it('refetches at once when nothing is loading', async () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      fixture.detectChanges();
      httpMock.expectOne(isListing).flush(mockDashboard);
      await fixture.whenStable();

      store.refreshWhenIdle();
      fixture.detectChanges();

      httpMock.expectOne(isListing).flush(mockDashboard);
    });
  });

  describe('page clamping (FE-8)', () => {
    /** Lets resource effects run without waiting on requests that are intentionally left open. */
    const settle = async () => {
      fixture.detectChanges();
      await Promise.resolve();
      fixture.detectChanges();
    };

    it('steps back when the current page no longer exists after a refresh', async () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      fixture.detectChanges();
      httpMock.expectOne(() => true).flush(mockDashboard); // 3 pages
      await settle();
      store.setPage(2);
      await settle();
      httpMock.expectOne('/api/v1/appointments?page=2&size=50').flush({
        ...mockDashboard,
        page: { content: [], page: { number: 2, size: 50, totalElements: 100, totalPages: 2 } },
      } satisfies AppointmentDashboardResponse);
      await settle();

      expect(store.currentPage()).toBe(1);
      httpMock.expectOne('/api/v1/appointments?page=1&size=50').flush({
        ...mockDashboard,
        page: {
          ...mockDashboard.page,
          page: { number: 1, size: 50, totalElements: 100, totalPages: 2 },
        },
      } satisfies AppointmentDashboardResponse);
      await settle();
      expect(store.currentPage()).toBe(1);
    });

    it('does not clamp while a later page is still loading', async () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      fixture.detectChanges();
      httpMock.expectOne(() => true).flush(mockDashboard);
      await settle();

      store.setPage(2);
      await settle();

      // While page 2 loads the resource reports its 1-page default; that must not clamp.
      expect(store.currentPage()).toBe(2);
      httpMock.expectOne('/api/v1/appointments?page=2&size=50').flush(mockDashboard);
      await settle();
      expect(store.currentPage()).toBe(2);
    });
  });

  describe('session end (FE-8)', () => {
    it('resets page, filter and search when the session ends', () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      store.currentPage.set(2);
      store.selectedFilter.set('pending');
      store.searchQuery.set('Alice');
      store.searchDebounced.set('Alice');

      authState.clear();

      expect(store.currentPage()).toBe(0);
      expect(store.selectedFilter()).toBe('all');
      expect(store.searchQuery()).toBe('');
      expect(store.searchDebounced()).toBe('');
      // The dashboard request that the logged-in state had started is moot now.
      httpMock.match(() => true);
    });

    it('drops a pending search debounce so it cannot restore the old query', () => {
      vi.useFakeTimers();
      try {
        authState.applyRole('ROLE_ADMIN', 'admin');
        store.onSearchChange('Alice');

        authState.clear();
        vi.advanceTimersByTime(300);

        expect(store.searchDebounced()).toBe('');
        httpMock.match(() => true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
