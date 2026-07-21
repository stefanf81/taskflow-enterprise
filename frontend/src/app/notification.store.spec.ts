import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, inject } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NotificationStore } from './notification.store';
import { NotificationItem } from './appointment.service';

@Component({ standalone: true, template: '' })
class TestHost {
  readonly store = inject(NotificationStore);
}

describe('NotificationStore', () => {
  let store: NotificationStore;
  let httpMock: HttpTestingController;
  let fixture: ComponentFixture<TestHost>;

  const mockNotifications: NotificationItem[] = [
    { id: 1, recipient: 'alice@example.com', type: 'EMAIL', message: 'Your appointment is confirmed', sentAt: '2026-07-01T10:00:00', status: 'SENT' },
    { id: 2, recipient: 'bob@example.com', type: 'EMAIL', message: 'Reminder: Appointment tomorrow', sentAt: '2026-07-02T08:00:00', status: 'SENT' },
  ];

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [provideHttpClient(), provideHttpClientTesting(), NotificationStore],
    });

    fixture = TestBed.createComponent(TestHost);
    store = fixture.componentInstance.store;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    // Flush the initial auto-triggered httpResource request.
    httpMock
      .match((req) => req.url.includes('/api/v1/notifications'))
      .forEach((req) => req.flush([]));
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should initialize with empty notifications', () => {
    expect(store.notifications()).toEqual([]);
    expect(store.errorMessage()).toBeNull();
  });

  it('should load notifications via loadNotifications', async () => {
    store.loadNotifications();
    fixture.detectChanges();

    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/notifications'));
    expect(req.request.method).toBe('GET');
    req.flush(mockNotifications);

    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.notifications().length).toBe(2);
    expect(store.notifications()[0].recipient).toBe('alice@example.com');
  });

  it('should surface error message on HTTP failure', async () => {
    store.loadNotifications();
    fixture.detectChanges();

    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/notifications'));
    req.error(new ProgressEvent('error'), { status: 500, statusText: 'Server Error' });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.errorMessage()).toBe('Could not load notification outbox.');
  });

  it('should reload notifications on repeated calls', async () => {
    // First load
    store.loadNotifications();
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.includes('/api/v1/notifications')).flush(mockNotifications);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(store.notifications().length).toBe(2);

    // Second load
    store.loadNotifications();
    fixture.detectChanges();
    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/notifications'));
    req.flush([mockNotifications[0]]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.notifications().length).toBe(1);
  });
});
