import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthState } from '../../core/auth/auth.state';
import { AdminStats } from './admin-stats';
import { AppointmentStore } from './appointment.store';
import { AppointmentDashboardResponse } from '../../types/api';

const DASHBOARD: AppointmentDashboardResponse = {
  page: { content: [], page: { number: 0, size: 50, totalElements: 0, totalPages: 1 } },
  stats: {
    total: 6,
    pending: 2,
    approved: 3,
    denied: 1,
    overdue: 1,
    progress: 50,
    approvedRevenue: 95,
  },
};

describe('AdminStats', () => {
  let fixture: ComponentFixture<AdminStats>;
  let httpMock: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  /** Each tile as `[label, value]`. */
  const tiles = () =>
    Array.from(el().querySelectorAll('section > div')).map((tile) => {
      const [label, value] = Array.from(tile.querySelectorAll('span')).map((span) =>
        span.textContent?.trim(),
      );
      return [label, value];
    });
  const answer = async (respond: (r: TestRequest) => void) => {
    TestBed.tick();
    httpMock
      .match((r) => r.url.includes('/api/v1/appointments') && r.method === 'GET')
      .forEach(respond);
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [AdminStats],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    // The list (and so the numbers) is only loaded for a signed-in owner.
    TestBed.inject(AuthState).applyRole('ROLE_ADMIN', 'admin');
    fixture = TestBed.createComponent(AdminStats);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    await answer((r) => r.flush(DASHBOARD));
  });

  it('shows the booking numbers, the revenue and the approval progress', () => {
    expect(tiles()).toEqual([
      ['Total Bookings', '6'],
      ['Pending Approval', '2'],
      ['Approved Slots', '3'],
      ['Overdue Pending', '1'],
      ['Estimated Revenue', '$95.00'],
    ]);

    const bar = el().querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
  });

  it('shows nothing (not a board of zeros) while the list fails to load, then comes back', async () => {
    const store = TestBed.inject(AppointmentStore);
    store.refresh();
    fixture.detectChanges();
    await answer((r) => r.flush(null, { status: 500, statusText: 'Server Error' }));

    expect(el().textContent).not.toContain('Total Bookings');
    expect(el().querySelector('[role="progressbar"]')).toBeNull();

    store.refresh();
    fixture.detectChanges();
    await answer((r) => r.flush(DASHBOARD));
    expect(el().textContent).toContain('Total Bookings');
  });
});
