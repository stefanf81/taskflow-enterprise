import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AdminSchedulesTab } from './admin-schedules-tab';
import { BarberStore } from '../../barber.store';

describe('AdminSchedulesTab', () => {
  let fixture: ComponentFixture<AdminSchedulesTab>;
  let component: AdminSchedulesTab;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminSchedulesTab],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminSchedulesTab);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    httpMock
      .match((r) => r.url.includes('/api/v1/barbers') && !r.url.includes('time-off'))
      .forEach((r) => r.flush([{ id: 1, name: 'Alex the Barber', email: '', phone: '' }]));
  });

  it('requires both dates before submitting time off', () => {
    component.addTimeOff();
    expect(component.timeOffActionError()).toBe('Start and end dates are required.');
    httpMock.expectNone((r) => r.url.includes('/time-off') && r.method === 'POST');
  });

  it('posts validated time off through the Signal Form model', () => {
    const store = TestBed.inject(BarberStore);
    store.selectBarber(1);

    component.timeOffModel.set({
      startDate: '2026-09-01',
      endDate: '2026-09-05',
      reason: 'Vacation',
    });
    component.addTimeOff();

    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/barbers/1/time-off'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      startDate: '2026-09-01',
      endDate: '2026-09-05',
      reason: 'Vacation',
    });
    expect(component.timeOffModel().startDate).toBe('');
  });

  it('surfaces a time-off write error on the store action error signal', () => {
    const store = TestBed.inject(BarberStore);
    store.selectBarber(1);

    component.timeOffModel.set({
      startDate: '2026-09-01',
      endDate: '2026-09-05',
      reason: '',
    });
    component.addTimeOff();

    httpMock
      .expectOne((r) => r.url.includes('/api/v1/barbers/1/time-off'))
      .error(new ProgressEvent('error'), { status: 400, statusText: 'Bad Request' });

    expect(store.actionErrorMessage()).toBeTruthy();
  });
});
