import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthState } from '../../core/auth/auth.state';
import { AppointmentDashboardResponse, AppointmentResponse } from '../../types/api';
import { AdminCalendarTab } from './admin-calendar-tab';
import { CalendarStore } from './calendar.store';

const item = (
  id: number,
  barberName: string,
  bookingDate: string,
  bookingTime: string,
  status = 'PENDING',
): AppointmentResponse => ({
  id,
  publicId: `p${id}`,
  customerName: `Customer ${id}`,
  customerEmail: 'c@example.com',
  customerPhone: '1',
  barberName,
  bookingDate,
  bookingTime,
  serviceType: 'Classic Haircut',
  status,
  createdAt: '',
  updatedAt: '',
});

const dashboard = (content: AppointmentResponse[]): AppointmentDashboardResponse => ({
  page: { content, page: { number: 0, size: 100, totalElements: content.length, totalPages: 1 } },
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

const BARBERS = [
  { id: 1, name: 'Alex', email: 'a@example.com', phone: '1' },
  { id: 2, name: 'Sara', email: 's@example.com', phone: '2' },
];

describe('AdminCalendarTab', () => {
  let fixture: ComponentFixture<AdminCalendarTab>;
  let http: HttpTestingController;
  let store: CalendarStore;
  const el = () => fixture.nativeElement as HTMLElement;
  const headers = () =>
    Array.from(el().querySelectorAll('thead th'))
      .slice(1)
      .map((th) => th.textContent?.replace(/\s+/g, ' ').trim());
  const rowLabels = () =>
    Array.from(el().querySelectorAll('tbody th')).map((th) => th.textContent?.trim());
  const events = () =>
    Array.from(el().querySelectorAll('.calendar-event')).map((e) =>
      e.textContent?.replace(/\s+/g, ' ').trim(),
    );
  /**
   * Answers whatever is asked: the barber roster, the calendar range, and (as a failure, so the
   * shop's default opening hours apply) the shop info.
   */
  const answer = async (bookings: AppointmentResponse[]) => {
    // Flushing can start more requests (a resource that reacts to an answer): go until quiet.
    for (let round = 0; round < 5; round++) {
      TestBed.tick();
      const pending = http.match(() => true);
      if (pending.length === 0) break;
      pending.forEach((r: TestRequest) => {
        if (r.request.url.includes('/barbers')) r.flush(BARBERS);
        else if (r.request.url === '/api/v1/appointments') r.flush(dashboard(bookings));
        else r.flush(null, { status: 500, statusText: 'Server Error' });
      });
    }
    // A macrotask is enough (the testing backend answers synchronously); `fixture.whenStable()`
    // does not settle for this component.
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [AdminCalendarTab],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(AuthState).applyRole('ROLE_ADMIN', 'admin');
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(CalendarStore);
    store.goTo('2026-11-24'); // a Tuesday
    fixture = TestBed.createComponent(AdminCalendarTab);
    fixture.detectChanges();
    await answer([
      item(1, 'Alex', '2026-11-24', '09:00', 'APPROVED'),
      item(2, 'Sara', '2026-11-24', '10:30'),
      item(3, 'Alex', '2026-11-24', '10:00', 'DENIED'),
      item(4, 'Alex', '2026-11-24', '11:00', 'CANCELLED'),
    ]);
  });

  it('shows the day with a column per barber and a row per opening hour', () => {
    expect(el().querySelector('h2')?.textContent).toContain('Tuesday, November 24, 2026');
    expect(headers()).toEqual(['Alex', 'Sara']);
    expect(rowLabels()).toEqual([
      '9 AM',
      '10 AM',
      '11 AM',
      '12 PM',
      '1 PM',
      '2 PM',
      '3 PM',
      '4 PM',
    ]);
  });

  it('draws only bookings that hold a slot, in their barber and hour', () => {
    expect(events()).toEqual([
      '9:00 AM Customer 1 Classic Haircut',
      '10:30 AM Customer 2 Classic Haircut',
    ]);
    const cells = Array.from(el().querySelectorAll('tbody tr')).map((row) =>
      Array.from(row.querySelectorAll('td')).map(
        (cell) => cell.querySelectorAll('.calendar-event').length,
      ),
    );
    expect(cells[0]).toEqual([1, 0]); // 9 AM: Alex
    expect(cells[1]).toEqual([0, 1]); // 10 AM: Sara (10:30), the denied one is gone
    expect(el().textContent).toContain('2 bookings');
  });

  it('pages to the next day and back to today', async () => {
    const buttons = () => Array.from(el().querySelectorAll('button'));
    buttons()
      .find((b) => b.getAttribute('aria-label') === 'Next day')!
      .click();
    fixture.detectChanges();
    await answer([]);
    expect(el().querySelector('h2')?.textContent).toContain('Wednesday, November 25, 2026');
    expect(events()).toEqual([]);
    expect(el().textContent).toContain('0 bookings');

    buttons()
      .find((b) => b.textContent?.trim() === 'Today')!
      .click();
    fixture.detectChanges();
    await answer([]);
    expect(store.anchor()).not.toBe('2026-11-25');
  });

  it('switches to the week: a column per day, and a day header opens that day', async () => {
    const weekButton = Array.from(el().querySelectorAll('app-segmented-control button')).find(
      (b) => b.textContent?.trim() === 'Week',
    ) as HTMLButtonElement;
    weekButton.click();
    fixture.detectChanges();
    await answer([
      item(1, 'Alex', '2026-11-24', '09:00', 'APPROVED'),
      item(2, 'Sara', '2026-11-26', '10:30'),
    ]);

    expect(el().querySelector('h2')?.textContent).toContain('Nov 23 – Nov 29, 2026');
    expect(headers().map((h) => h?.split(' ')[0])).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
    // the barber shows on each booking when no barber is chosen
    expect(events()).toEqual([
      '9:00 AM Customer 1 Classic Haircut · Alex',
      '10:30 AM Customer 2 Classic Haircut · Sara',
    ]);

    const thursday = Array.from(el().querySelectorAll('thead th button')).find((b) =>
      b.getAttribute('aria-label')?.startsWith('Open Thu 26'),
    ) as HTMLButtonElement;
    thursday.click();
    fixture.detectChanges();
    expect(store.view()).toBe('day');
    expect(store.anchor()).toBe('2026-11-26');
    await answer([]);
  });

  it('narrows the week to one barber', async () => {
    (
      Array.from(el().querySelectorAll('app-segmented-control button')).find(
        (b) => b.textContent?.trim() === 'Week',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await answer([
      item(1, 'Alex', '2026-11-24', '09:00', 'APPROVED'),
      item(2, 'Sara', '2026-11-26', '10:30'),
    ]);

    const select = el().querySelector('#calendar-barber') as HTMLSelectElement;
    select.value = 'Sara';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(events()).toEqual(['10:30 AM Customer 2 Classic Haircut']);
    expect(el().textContent).toContain('1 booking');
  });

  it('offers a retry when the calendar cannot be loaded', async () => {
    store.refresh();
    TestBed.tick();
    http
      .match((r) => r.url === '/api/v1/appointments')
      .forEach((r) => r.flush(null, { status: 500, statusText: 'Server Error' }));
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    expect(el().textContent).toContain('Could not load the calendar. Please retry.');
    expect(el().querySelector('table')).toBeNull();
    const retry = Array.from(el().querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Retry',
    ) as HTMLButtonElement;
    retry.click();
    await answer([]);
    expect(el().querySelector('table')).not.toBeNull();
  });

  describe('selected booking', () => {
    const chip = (text: string) =>
      Array.from(el().querySelectorAll<HTMLButtonElement>('.calendar-event')).find((b) =>
        b.textContent?.includes(text),
      )!;
    const panel = () => el().querySelector('section[aria-label="Selected booking"]');
    const panelButtons = () =>
      Array.from(panel()?.querySelectorAll('button') ?? []).map(
        (b) => b.textContent?.trim() || b.getAttribute('aria-label'),
      );

    it('opens a booking panel with its details, and closes it again', () => {
      expect(panel()).toBeNull();
      chip('Customer 2').click();
      fixture.detectChanges();

      expect(panel()?.textContent).toContain('Customer 2');
      expect(panel()?.textContent).toContain('c@example.com');
      expect(panel()?.textContent).toContain('Pending');
      expect(chip('Customer 2').getAttribute('aria-pressed')).toBe('true');
      // A pending booking can be approved, denied or cancelled.
      expect(panelButtons()).toEqual(['Approve', 'Deny', 'Cancel booking', 'Close']);

      chip('Customer 2').click(); // the same chip again
      fixture.detectChanges();
      expect(panel()).toBeNull();
    });

    it('offers no Approve on an approved booking', () => {
      chip('Customer 1').click();
      fixture.detectChanges();
      expect(panelButtons()).toEqual(['Deny', 'Cancel booking', 'Close']);
    });

    it('approves from the panel and reloads the calendar', async () => {
      chip('Customer 2').click();
      fixture.detectChanges();
      (
        Array.from(panel()!.querySelectorAll('button')).find(
          (b) => b.textContent?.trim() === 'Approve',
        ) as HTMLButtonElement
      ).click();

      const put = http.expectOne(
        (r) => r.url.endsWith('/api/v1/appointments/2') && r.method === 'PUT',
      );
      expect(put.request.body).toEqual({ status: 'APPROVED' });
      put.flush({ ...item(2, 'Sara', '2026-11-24', '10:30', 'APPROVED') });
      await new Promise((resolve) => setTimeout(resolve));
      fixture.detectChanges();

      // The calendar asked for its range again.
      await answer([
        item(1, 'Alex', '2026-11-24', '09:00', 'APPROVED'),
        item(2, 'Sara', '2026-11-24', '10:30', 'APPROVED'),
      ]);
      expect(panel()?.textContent).toContain('Approved');
      expect(panelButtons()).not.toContain('Approve');
    });

    it('closes the panel when its booking leaves the calendar', async () => {
      chip('Customer 2').click();
      fixture.detectChanges();
      store.refresh();
      await answer([item(1, 'Alex', '2026-11-24', '09:00', 'APPROVED')]);
      expect(panel()).toBeNull();
    });
  });
});
