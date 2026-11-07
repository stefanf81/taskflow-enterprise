import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminWeeklySchedule } from './admin-weekly-schedule';
import { AppointmentStore } from './appointment.store';
import { BarberStore } from './barber.store';

describe('AdminWeeklySchedule', () => {
  let fixture: ComponentFixture<AdminWeeklySchedule>;
  let httpMock: HttpTestingController;
  let store: BarberStore;
  const refresh = vi.fn();

  const element = () => fixture.nativeElement as HTMLElement;
  const button = (label: string) =>
    Array.from(element().querySelectorAll('button')).find((b) =>
      b.textContent?.includes(label),
    ) as HTMLButtonElement;
  const timeInput = (label: string) =>
    element().querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    refresh.mockReset();
    TestBed.configureTestingModule({
      imports: [AdminWeeklySchedule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AppointmentStore, useValue: { refresh } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(BarberStore);
    store.selectedBarberId.set(1);
    fixture = TestBed.createComponent(AdminWeeklySchedule);
    fixture.detectChanges();

    httpMock
      .match((r) => r.url === '/api/v1/barbers/admin' || r.url.includes('/time-off'))
      .forEach((r) => r.flush([]));
    httpMock.expectOne('/api/v1/barbers/1/schedule').flush({
      days: [
        { dayOfWeek: 1, opens: '09:00', closes: '17:00' },
        { dayOfWeek: 2, opens: '09:00', closes: '17:00' },
      ],
      revision: 'rev-1',
    });
    await settle();
  });

  afterEach(() => httpMock.verify());

  it('shows each weekday with its hours, and closed days as not working', () => {
    expect(timeInput('Monday closes').value).toBe('17:00');
    expect(element().textContent).toContain('Not working');
    // Nothing changed yet: nothing to review.
    expect(button('Review changes').disabled).toBe(true);
  });

  it('refuses a shift that does not open before it closes', async () => {
    timeInput('Monday closes').value = '08:00';
    timeInput('Monday closes').dispatchEvent(new Event('change'));
    await settle();

    expect(element().textContent).toContain('Monday must open before it closes.');
    expect(button('Review changes').disabled).toBe(true);
  });

  it('previews the change, requires confirming the cancellations, then saves', async () => {
    timeInput('Monday closes').value = '15:00';
    timeInput('Monday closes').dispatchEvent(new Event('change'));
    await settle();
    button('Review changes').click();

    const preview = httpMock.expectOne('/api/v1/barbers/1/schedule/preview');
    expect(preview.request.body).toEqual({
      days: [
        { dayOfWeek: 1, opens: '09:00', closes: '15:00' },
        { dayOfWeek: 2, opens: '09:00', closes: '17:00' },
      ],
      expectedRevision: 'rev-1',
      cancelConflictingAppointments: false,
    });
    preview.flush({ conflictCount: 1, conflictsRevision: 'c-1' });
    await settle();

    expect(element().textContent).toContain('1 upcoming booking(s) fall outside the new hours');
    expect(button('Save and cancel 1 booking(s)').disabled).toBe(true);
    const confirm = Array.from(element().querySelectorAll('label'))
      .find((l) => l.textContent?.includes('Cancel these 1 booking(s)'))!
      .querySelector('input') as HTMLInputElement;
    confirm.click();
    await settle();
    expect(button('Save and cancel 1 booking(s)').disabled).toBe(false);
    button('Save and cancel 1 booking(s)').click();

    const update = httpMock.expectOne(
      (r) => r.url === '/api/v1/barbers/1/schedule' && r.method === 'PUT',
    );
    expect(update.request.body).toEqual({
      days: [
        { dayOfWeek: 1, opens: '09:00', closes: '15:00' },
        { dayOfWeek: 2, opens: '09:00', closes: '17:00' },
      ],
      expectedRevision: 'rev-1',
      expectedConflicts: 'c-1',
      cancelConflictingAppointments: true,
    });
    update.flush({
      days: [
        { dayOfWeek: 1, opens: '09:00', closes: '15:00' },
        { dayOfWeek: 2, opens: '09:00', closes: '17:00' },
      ],
      revision: 'rev-2',
    });
    await settle();

    expect(store.actionSuccessMessage()).toBe('Weekly schedule updated.');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(store.schedule()?.revision).toBe('rev-2');
    // The shop's hours changed: the public shop info is refetched.
    httpMock
      .match((r) => r.url.includes('/api/v1/appointments/public/shop'))
      .forEach((r) => r.flush({ timeZone: 'UTC', maxAdvanceDays: 90, openingHours: [] }));
  });

  it('drops a preview as soon as the draft changes again', async () => {
    timeInput('Monday closes').value = '16:00';
    timeInput('Monday closes').dispatchEvent(new Event('change'));
    await settle();
    button('Review changes').click();
    httpMock
      .expectOne('/api/v1/barbers/1/schedule/preview')
      .flush({ conflictCount: 0, conflictsRevision: 'c-0' });
    await settle();
    expect(button('Save weekly hours')).toBeTruthy();

    timeInput('Monday closes').value = '15:00';
    timeInput('Monday closes').dispatchEvent(new Event('change'));
    await settle();

    expect(button('Save weekly hours')).toBeUndefined();
    expect(button('Review changes').disabled).toBe(false);
  });
});
