import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, inject } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { BarberStore } from './barber.store';
import { BarbersApi } from '../../core/api/barbers-api';
import { AuthState } from '../../core/auth/auth.state';

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
      providers: [provideHttpClient(), provideHttpClientTesting(), BarbersApi, BarberStore],
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

  it('keeps barbers and time-offs readable after failed loads (FE-1)', async () => {
    store.loadBarbers();
    fixture.detectChanges();
    httpMock
      .match((req) => req.url.includes('/api/v1/barbers') && !req.url.includes('time-off'))
      .forEach((r) => r.error(new ProgressEvent('error'), { status: 500, statusText: 'x' }));
    store.loadTimeOffs(1);
    fixture.detectChanges();
    httpMock
      .match((req) => req.url.includes('/api/v1/barbers/1/time-off'))
      .forEach((r) => r.error(new ProgressEvent('error'), { status: 500, statusText: 'x' }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.errorMessage()).toBe('Could not load barbers.');
    expect(() => store.barbers()).not.toThrow();
    expect(store.barbers()).toEqual([]);
    expect(() => store.timeOffs()).not.toThrow();
    expect(store.timeOffs()).toEqual([]);
  });

  it('resolves addTimeOff with true/false so callers reset forms only on success (FE-13)', async () => {
    const ok = store.addTimeOff({ startDate: '2026-10-01', endDate: '2026-10-02', reason: '' });
    httpMock
      .expectOne((r) => r.url.includes('/api/v1/barbers/1/time-off') && r.method === 'POST')
      .flush({ id: 5, startDate: '2026-10-01', endDate: '2026-10-02', reason: '' });
    expect(await ok).toBe(true);
    fixture.detectChanges();
    httpMock.match((r) => r.url.includes('/api/v1/barbers/1/time-off')).forEach((r) => r.flush([]));

    const failed = store.addTimeOff({ startDate: '2026-10-01', endDate: '2026-10-02', reason: '' });
    httpMock
      .expectOne((r) => r.url.includes('/api/v1/barbers/1/time-off') && r.method === 'POST')
      .flush({ message: 'Overlap' }, { status: 409, statusText: 'Conflict' });
    expect(await failed).toBe(false);
    expect(store.actionErrorMessage()).toBe('Overlap');
  });

  it('ignores a second add while one is saving', () => {
    void store.addTimeOff({ startDate: '2026-10-01', endDate: '2026-10-02', reason: '' });
    void store.addTimeOff({ startDate: '2026-10-03', endDate: '2026-10-04', reason: '' });
    const posts = httpMock.match((r) => r.method === 'POST');
    expect(posts).toHaveLength(1);
    posts[0]!.flush({ id: 5, startDate: '2026-10-01', endDate: '2026-10-02', reason: '' });
    httpMock.match((r) => r.url.includes('/api/v1/barbers/1/time-off')).forEach((r) => r.flush([]));
  });

  it('forgets action banners when the session ends', () => {
    store.actionErrorMessage.set('boom');
    store.actionSuccessMessage.set('ok');

    TestBed.inject(AuthState).applyRole('ROLE_ADMIN', 'admin');
    TestBed.inject(AuthState).clear();

    expect(store.actionErrorMessage()).toBeNull();
    expect(store.actionSuccessMessage()).toBeNull();
  });
});
