import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AdminSchedulesTab } from './admin-schedules-tab';
import { BarberStore } from './barber.store';
import { AuthState } from '../../core/auth/auth.state';

describe('AdminSchedulesTab', () => {
  let fixture: ComponentFixture<AdminSchedulesTab>;
  let component: AdminSchedulesTab;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminSchedulesTab],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    TestBed.inject(AuthState).applyRole('ROLE_ADMIN', 'admin');
    fixture = TestBed.createComponent(AdminSchedulesTab);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    httpMock
      .match((r) => r.url.includes('/api/v1/barbers') && !r.url.includes('time-off'))
      .forEach((r) => r.flush([{ id: 1, name: 'Alex the Barber', email: '', phone: '' }]));
  });

  it('highlights the selected barber with real Tailwind classes', () => {
    const store = TestBed.inject(BarberStore);
    const card = (): HTMLElement =>
      fixture.nativeElement.querySelector('[aria-label="Select barber: Alex the Barber"]');
    const select = (id: number): void => {
      store.selectBarber(id);
      fixture.detectChanges();
      httpMock.match((r) => r.url.includes('/time-off')).forEach((r) => r.flush([]));
    };

    select(2);
    expect(card().classList).toContain('bg-zinc-900');
    expect(card().classList).toContain('border-white/5');
    expect(card().classList).not.toContain('bg-gold/20');

    select(1);
    expect(card().classList).toContain('bg-gold/20');
    expect(card().classList).toContain('border-gold');
    expect(card().classList).not.toContain('bg-zinc-900');
    // The static classes survive the [class] binding.
    expect(card().classList).toContain('p-4');
  });

  it('requires both dates before submitting time off', () => {
    component.addTimeOff();
    expect(component.timeOffActionError()).toBe('Start and end dates are required.');
    httpMock.expectNone((r) => r.url.includes('/time-off') && r.method === 'POST');
  });

  it('posts validated time off through the Signal Form model', async () => {
    const store = TestBed.inject(BarberStore);
    store.selectBarber(1);

    component.timeOffModel.set({
      startDate: '2026-09-01',
      endDate: '2026-09-05',
      reason: 'Vacation',
    });
    const saving = component.addTimeOff();

    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/barbers/1/time-off'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      startDate: '2026-09-01',
      endDate: '2026-09-05',
      reason: 'Vacation',
    });
    // Not reset while the request is still in flight.
    expect(component.timeOffModel().startDate).toBe('2026-09-01');

    req.flush({ id: 9, startDate: '2026-09-01', endDate: '2026-09-05', reason: 'Vacation' });
    await saving;

    expect(component.timeOffModel().startDate).toBe('');
    expect(component.timeOffModel().reason).toBe('');
    // The server may have cancelled conflicting bookings: the list and time-offs refetch.
    httpMock.match(() => true);
  });

  it('keeps the form input and shows the server message when the write fails', async () => {
    const store = TestBed.inject(BarberStore);
    store.selectBarber(1);

    component.timeOffModel.set({
      startDate: '2026-09-01',
      endDate: '2026-09-05',
      reason: 'Vacation',
    });
    const saving = component.addTimeOff();

    httpMock
      .expectOne((r) => r.url.includes('/api/v1/barbers/1/time-off'))
      .flush({ message: 'Overlaps existing time off' }, { status: 409, statusText: 'Conflict' });
    await saving;

    expect(store.actionErrorMessage()).toBe('Overlaps existing time off');
    expect(component.timeOffModel()).toEqual({
      startDate: '2026-09-01',
      endDate: '2026-09-05',
      reason: 'Vacation',
    });
  });
});
