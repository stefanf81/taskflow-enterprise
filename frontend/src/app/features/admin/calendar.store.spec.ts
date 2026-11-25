import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthState } from '../../core/auth/auth.state';
import { SessionEvents } from '../../core/session-events';
import { AppointmentDashboardResponse, AppointmentResponse } from '../../types/api';
import { CalendarStore } from './calendar.store';

const item = (id: number, date = '2026-11-24'): AppointmentResponse => ({
  id,
  publicId: `p${id}`,
  customerName: `C${id}`,
  customerEmail: 'c@example.com',
  customerPhone: '1',
  barberName: 'Alex',
  bookingDate: date,
  bookingTime: '10:00',
  serviceType: 'Cut',
  status: 'PENDING',
  createdAt: '',
  updatedAt: '',
});

const dashboard = (
  content: AppointmentResponse[],
  number = 0,
  totalPages = 1,
): AppointmentDashboardResponse => ({
  page: { content, page: { number, size: 100, totalElements: content.length, totalPages } },
  stats: {
    total: 0,
    pending: 0,
    approved: 0,
    denied: 0,
    overdue: 0,
    progress: 0,
    approvedRevenue: 0,
  },
});

describe('CalendarStore', () => {
  let store: CalendarStore;
  let http: HttpTestingController;
  const requests = () => http.match((r) => r.url === '/api/v1/appointments' && r.method === 'GET');
  const only = () => {
    const found = requests();
    expect(found).toHaveLength(1);
    return found[0] as TestRequest;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthState).applyRole('ROLE_ADMIN', 'admin');
    store = TestBed.inject(CalendarStore);
    store.goTo('2026-11-24');
  });

  it('loads just the shown day and keeps it', () => {
    TestBed.tick();
    const req = only();
    expect(req.request.params.get('from')).toBe('2026-11-24');
    expect(req.request.params.get('to')).toBe('2026-11-24');
    expect(req.request.params.get('size')).toBe('100');
    expect(store.isLoading()).toBe(true);
    req.flush(dashboard([item(1)]));

    expect(store.appointments().map((a) => a.id)).toEqual([1]);
    expect(store.isLoading()).toBe(false);
    expect(store.loadError()).toBeNull();
  });

  it('asks for the Monday-to-Sunday week in the week view and steps by seven days', () => {
    TestBed.tick();
    only().flush(dashboard([]));

    store.setView('week');
    TestBed.tick();
    let req = only();
    expect([req.request.params.get('from'), req.request.params.get('to')]).toEqual([
      '2026-11-23',
      '2026-11-29',
    ]);
    req.flush(dashboard([]));

    store.step(1);
    TestBed.tick();
    req = only();
    expect([req.request.params.get('from'), req.request.params.get('to')]).toEqual([
      '2026-11-30',
      '2026-12-06',
    ]);
    req.flush(dashboard([]));
  });

  it('fetches the remaining pages of a busy range and joins them', () => {
    TestBed.tick();
    only().flush(dashboard([item(1)], 0, 3));

    const rest = requests();
    expect(rest.map((r) => r.request.params.get('page')).sort()).toEqual(['1', '2']);
    rest.forEach((r) => r.flush(dashboard([item(Number(r.request.params.get('page')) + 10)])));

    expect(store.appointments().map((a) => a.id)).toEqual([1, 11, 12]);
    expect(store.isLoading()).toBe(false);
  });

  it('drops the answer for a range the owner has already left', () => {
    TestBed.tick();
    const stale = only();

    store.step(1);
    TestBed.tick();
    expect(stale.cancelled).toBe(true);
    only().flush(dashboard([item(2, '2026-11-25')]));

    expect(store.appointments().map((a) => a.id)).toEqual([2]);
  });

  it('keeps the shown bookings and offers a retry when a reload fails', () => {
    TestBed.tick();
    only().flush(dashboard([item(1)]));

    store.refresh();
    TestBed.tick();
    only().flush(null, { status: 500, statusText: 'Server Error' });

    expect(store.loadError()).toBe('Could not load the calendar. Please retry.');
    expect(store.appointments().map((a) => a.id)).toEqual([1]);
    expect(store.isLoading()).toBe(false);

    store.refresh();
    TestBed.tick();
    only().flush(dashboard([item(1), item(3)]));
    expect(store.loadError()).toBeNull();
    expect(store.appointments()).toHaveLength(2);
  });

  it('lets a running load finish on server events and then loads once more', () => {
    TestBed.tick();
    const running = only();

    // A burst of events while the (multi-page) load runs: none of them cancels it.
    store.refreshWhenIdle();
    store.refreshWhenIdle();
    store.refreshWhenIdle();
    TestBed.tick();
    expect(running.cancelled).toBe(false);
    expect(requests()).toHaveLength(0); // no second request beside the running one

    running.flush(dashboard([item(1)]));
    expect(store.appointments().map((a) => a.id)).toEqual([1]);

    // One follow-up load for the whole burst.
    TestBed.tick();
    only().flush(dashboard([item(1), item(2)]));
    expect(store.appointments().map((a) => a.id)).toEqual([1, 2]);
    TestBed.tick();
    expect(requests()).toHaveLength(0);
  });

  it('also loads once more after a load that failed while events arrived', () => {
    TestBed.tick();
    const running = only();
    store.refreshWhenIdle();
    running.flush(null, { status: 500, statusText: 'Server Error' });

    TestBed.tick();
    only().flush(dashboard([item(4)]));
    expect(store.loadError()).toBeNull();
    expect(store.appointments().map((a) => a.id)).toEqual([4]);
  });

  it('reloads at once on a server event when nothing is loading', () => {
    TestBed.tick();
    only().flush(dashboard([item(1)]));

    store.refreshWhenIdle();
    TestBed.tick();
    only().flush(dashboard([]));
    TestBed.tick();
    expect(requests()).toHaveLength(0);
  });

  it('does not reload for an event once the owner has moved to another day', () => {
    TestBed.tick();
    const stale = only();
    store.refreshWhenIdle();

    // The load for the new day starts after the event, so it already reflects it.
    store.step(1);
    TestBed.tick();
    expect(stale.cancelled).toBe(true);
    only().flush(dashboard([]));
    TestBed.tick();
    expect(requests()).toHaveLength(0);
  });

  it('empties when the session ends', () => {
    TestBed.tick();
    only().flush(dashboard([item(1)]));

    TestBed.inject(SessionEvents).notifySessionEnded();
    expect(store.appointments()).toEqual([]);
  });
});
