import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, inject } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { CustomerStore } from './customer.store';
import { AppointmentService } from './appointment.service';

@Component({ standalone: true, template: '' })
class TestHost {
  readonly store = inject(CustomerStore);
}

describe('CustomerStore', () => {
  let store: CustomerStore;
  let httpMock: HttpTestingController;
  let fixture: ComponentFixture<TestHost>;

  const mockAppointments = {
    content: [
      {
        id: 1, publicId: 'pub-1', customerName: 'Alice', customerEmail: 'alice@example.com',
        customerPhone: '123', barberName: 'Alex', bookingDate: '2026-08-01', bookingTime: '09:00',
        serviceType: 'Classic Haircut', status: 'PENDING', createdAt: '2026-07-01T00:00:00', updatedAt: '2026-07-01T00:00:00',
      },
    ],
    totalPages: 1,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [provideHttpClient(), provideHttpClientTesting(), AppointmentService, CustomerStore],
    });

    fixture = TestBed.createComponent(TestHost);
    store = fixture.componentInstance.store;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    // Flush the initial auto-triggered httpResource request
    httpMock
      .match((req) => req.url.includes('/api/v1/customer/appointments'))
      .forEach((req) => req.flush(mockAppointments));
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should initialize with default values', () => {
    expect(store.currentPage()).toBe(0);
    expect(store.appointments()).toEqual(mockAppointments.content);
    expect(store.cancelErrorMessage()).toBeNull();
    expect(store.isCancelling()).toBe(false);
  });

  it('should reload appointments via loadAppointments', () => {
    store.loadAppointments();
    fixture.detectChanges();

    const req = httpMock.expectOne(
      (r) => r.url.includes('/api/v1/customer/appointments') && r.method === 'GET',
    );
    expect(req.request.url).toContain('page=0');
    expect(req.request.url).toContain('size=10');
    req.flush(mockAppointments);
    fixture.detectChanges();

    expect(store.appointments().length).toBe(1);
    expect(store.appointments()[0].customerName).toBe('Alice');
  });

  it('should support pagination', () => {
    store.currentPage.set(1);
    store.loadAppointments();
    fixture.detectChanges();

    const req = httpMock.expectOne(
      (r) => r.url.includes('/api/v1/customer/appointments') && r.method === 'GET',
    );
    expect(req.request.url).toContain('page=1');
    req.flush({ content: [], totalPages: 0 });
    fixture.detectChanges();
  });

  it('should cancel an appointment via cancelAppointment', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    store.cancelAppointment(1);

    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/customer/appointments/1'));
    expect(req.request.method).toBe('DELETE');
    req.flush(null);

    expect(store.isCancelling()).toBe(false);
    expect(store.cancelErrorMessage()).toBeNull();
  });

  it('should skip cancellation if the user does not confirm', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    store.cancelAppointment(1);

    httpMock.expectNone((r) => r.url.includes('/api/v1/customer/appointments'));
    expect(store.isCancelling()).toBe(false);
  });

  it('should surface a cancel error on API failure', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    store.cancelAppointment(1);

    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/customer/appointments/1'));
    req.error(new ProgressEvent('error'), { status: 400, statusText: 'Bad Request' });

    expect(store.isCancelling()).toBe(false);
    expect(store.cancelErrorMessage()).toBeTruthy();
    expect(store.cancelErrorMessage()).not.toBeNull();
  });

  it('should extract error detail from backend response (error case)', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    store.cancelAppointment(1);

    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/customer/appointments/1'));
    req.flush({ message: 'Cannot cancel within 24 hours' }, { status: 400, statusText: 'Bad Request' });

    expect(store.cancelErrorMessage()).toBeTruthy();
  });
});
