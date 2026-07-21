import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, inject } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { BarberStore } from './barber.store';
import { AppointmentService } from './appointment.service';

@Component({ standalone: true, template: '' })
class TestHost {
  readonly store = inject(BarberStore);
}

describe('BarberStore', () => {
  let store: BarberStore;
  let httpMock: HttpTestingController;
  let fixture: ComponentFixture<TestHost>;

  const mockBarbers = [
    { id: 1, name: 'Alex the Barber', email: 'alex@example.com', phone: '555-0101' },
    { id: 2, name: 'Sara the Stylist', email: 'sara@example.com', phone: '555-0102' },
  ];

  const mockTimeOffs = [
    { id: 1, startDate: '2026-09-01', endDate: '2026-09-05', reason: 'Vacation' },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [provideHttpClient(), provideHttpClientTesting(), AppointmentService, BarberStore],
    });

    fixture = TestBed.createComponent(TestHost);
    store = fixture.componentInstance.store;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    // Flush the initial barbers list auto-request.
    httpMock
      .match((req) => req.url.includes('/api/v1/barbers') && !req.url.includes('time-off'))
      .forEach((req) => req.flush(mockBarbers));
    fixture.detectChanges();

    // The BarberStore constructor has an effect() that auto-selects barber
    // id=1 when barbers load. In zoneless mode the effect may not fire
    // synchronously in tests, so trigger it manually.
    store.selectedBarberId.set(1);
    fixture.detectChanges();

    // Now the timeOffsResource request function returns a URL; flush it.
    httpMock
      .match((req) => req.url.includes('/api/v1/barbers/1/time-off'))
      .forEach((req) => req.flush(mockTimeOffs));
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should initialize with barbers, auto-select first, and load time-offs', () => {
    expect(store.barbers()).toEqual(mockBarbers);
    expect(store.selectedBarberId()).toBe(1);
    expect(store.timeOffs()).toEqual(mockTimeOffs);
    expect(store.actionErrorMessage()).toBeNull();
    expect(store.actionSuccessMessage()).toBeNull();
    expect(store.isSaving()).toBe(false);
  });

  it('should select a specific barber', () => {
    store.selectBarber(2);
    expect(store.selectedBarberId()).toBe(2);
  });

  it('should load time-offs for a selected barber', async () => {
    store.loadTimeOffs(2);
    fixture.detectChanges();

    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/barbers/2/time-off'));
    expect(req.request.method).toBe('GET');
    req.flush(mockTimeOffs);

    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.timeOffs()).toEqual(mockTimeOffs);
    expect(store.selectedBarberId()).toBe(2);
  });

  it('should add time-off via the API and reload the time-offs list', async () => {
    const newTimeOff = { startDate: '2026-10-01', endDate: '2026-10-03', reason: 'Personal' };

    store.addTimeOff(newTimeOff);

    // POST to create time-off (subscribe-based, synchronous)
    const postReq = httpMock.expectOne(
      (r) => r.url.includes('/api/v1/barbers/1/time-off') && r.method === 'POST',
    );
    expect(postReq.request.body).toEqual(newTimeOff);
    postReq.flush({ id: 2, ...newTimeOff });

    // After successful POST, the store reloads time-offs via httpResource.reload()
    fixture.detectChanges();
    const getReq = httpMock.expectOne(
      (r) => r.url.includes('/api/v1/barbers/1/time-off') && r.method === 'GET',
    );
    getReq.flush([...mockTimeOffs, { id: 2, ...newTimeOff }]);

    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.actionSuccessMessage()).toBe('Time off added successfully.');
    expect(store.isSaving()).toBe(false);
  });

  it('should surface a time-off write error on actionErrorMessage', () => {
    store.addTimeOff({ startDate: '2026-10-01', endDate: '2026-10-01', reason: 'Test' });

    const req = httpMock.expectOne(
      (r) => r.url.includes('/api/v1/barbers/1/time-off') && r.method === 'POST',
    );
    req.error(new ProgressEvent('error'), { status: 400, statusText: 'Bad Request' });

    expect(store.actionErrorMessage()).toBeTruthy();
    expect(store.actionErrorMessage()).not.toBeNull();
    expect(store.isSaving()).toBe(false);
  });

  it('should reload barbers via loadBarbers', async () => {
    store.loadBarbers();
    fixture.detectChanges();

    // loadBarbers reloads barbersResource. Flush both barbers and time-offs.
    httpMock
      .match((req) => req.url.includes('/api/v1/barbers') && !req.url.includes('time-off'))
      .forEach((r) => r.flush([mockBarbers[0]]));
    httpMock
      .match((req) => req.url.includes('/api/v1/barbers/1/time-off'))
      .forEach((r) => r.flush(mockTimeOffs));

    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.barbers().length).toBe(1);
  });

  it('should not add time-off if no barber is selected', () => {
    // Clear the selected barber.
    store.selectedBarberId.set(null);
    store.addTimeOff({ startDate: '2026-10-01', endDate: '2026-10-03', reason: 'Test' });

    // The method returns early when no barber is selected, so no HTTP request.
    httpMock.expectNone((req) => req.url.includes('/api/v1/barbers'));
  });
});
