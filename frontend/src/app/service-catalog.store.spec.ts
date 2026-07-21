import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, inject } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ServiceCatalogStore } from './service-catalog.store';
import { ServiceItem } from './appointment.service';

@Component({ standalone: true, template: '' })
class TestHost {
  readonly store = inject(ServiceCatalogStore);
}

describe('ServiceCatalogStore', () => {
  let store: ServiceCatalogStore;
  let httpMock: HttpTestingController;
  let fixture: ComponentFixture<TestHost>;

  const mockServices: ServiceItem[] = [
    {
      id: 1,
      name: 'Classic Haircut',
      price: 25,
      durationMinutes: 30,
      category: 'hair',
      description: 'Desc',
    },
    {
      id: 2,
      name: 'Modern Skin Fade',
      price: 30,
      durationMinutes: 45,
      category: 'hair',
      description: 'Desc',
    },
    {
      id: 3,
      name: 'Beard Trim & Shave',
      price: 18,
      durationMinutes: 25,
      category: 'beard',
      description: 'Desc',
    },
  ];

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [provideHttpClient(), provideHttpClientTesting(), ServiceCatalogStore],
    });

    fixture = TestBed.createComponent(TestHost);
    store = fixture.componentInstance.store;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    // Flush the initial auto-triggered httpResource request.
    httpMock.match((req) => req.url.includes('/api/v1/catalog')).forEach((req) => req.flush([]));
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should initialize with empty services', () => {
    expect(store.services()).toEqual([]);
    expect(store.errorMessage()).toBeNull();
  });

  it('should load services via loadServices', async () => {
    store.loadServices();
    fixture.detectChanges();

    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/catalog'));
    expect(req.request.method).toBe('GET');
    req.flush(mockServices);

    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.services().length).toBe(3);
    expect(store.services()[0].name).toBe('Classic Haircut');
  });

  it('should surface error on HTTP failure', async () => {
    store.loadServices();
    fixture.detectChanges();

    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/catalog'));
    req.error(new ProgressEvent('error'), { status: 500, statusText: 'Server Error' });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.errorMessage()).toBe('Could not load service catalog.');
  });

  it('should reload services on repeated calls', async () => {
    // First load
    store.loadServices();
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.includes('/api/v1/catalog')).flush(mockServices);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(store.services().length).toBe(3);

    // Second load
    store.loadServices();
    fixture.detectChanges();
    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/catalog'));
    req.flush([mockServices[0]]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.services().length).toBe(1);
  });
});
