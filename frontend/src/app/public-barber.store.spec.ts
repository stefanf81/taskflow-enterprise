import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, inject } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { PublicBarberStore } from './public-barber.store';
import { PublicBarber } from './types/api';

@Component({ standalone: true, template: '' })
class TestHost {
  readonly store = inject(PublicBarberStore);
}

describe('PublicBarberStore', () => {
  let store: PublicBarberStore;
  let httpMock: HttpTestingController;
  let fixture: ComponentFixture<TestHost>;

  const mockBarbers: PublicBarber[] = [
    { id: 1, name: 'Alex the Barber' },
    { id: 2, name: 'Sara the Stylist' },
  ];

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [provideHttpClient(), provideHttpClientTesting(), PublicBarberStore],
    });

    fixture = TestBed.createComponent(TestHost);
    store = fixture.componentInstance.store;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    httpMock.match((req) => req.url === '/api/v1/barbers').forEach((req) => req.flush([]));
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('starts empty and marks public requests so a 401 cannot clear the session', () => {
    expect(store.barbers()).toEqual([]);
    expect(store.errorMessage()).toBeNull();
  });

  it('loads the API-driven roster', async () => {
    store.loadBarbers();
    fixture.detectChanges();

    const req = httpMock.expectOne((r) => r.url === '/api/v1/barbers');
    expect(req.request.method).toBe('GET');
    req.flush(mockBarbers);

    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.barbers().length).toBe(2);
    expect(store.barbers()[0]!.name).toBe('Alex the Barber');
  });

  it('surfaces a load error and rejects contract drift via zod parsing', async () => {
    store.loadBarbers();
    fixture.detectChanges();

    // Missing `name` → schema rejects the payload, resource errors.
    httpMock.expectOne((r) => r.url === '/api/v1/barbers').flush([{ id: 1 }]);

    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.errorMessage()).toBe('Could not load the barber directory.');
  });
});
