import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, inject } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ReviewStore } from './review.store';
import { BarberRating } from './appointment.service';

@Component({ standalone: true, template: '' })
class TestHost {
  readonly store = inject(ReviewStore);
}

describe('ReviewStore', () => {
  let store: ReviewStore;
  let httpMock: HttpTestingController;
  let fixture: ComponentFixture<TestHost>;

  const mockRatings: BarberRating[] = [
    { barberName: 'Alex the Barber', averageRating: 4.8, reviewCount: 12 },
    { barberName: 'Sara the Stylist', averageRating: 4.9, reviewCount: 15 },
  ];

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [provideHttpClient(), provideHttpClientTesting(), ReviewStore],
    });

    fixture = TestBed.createComponent(TestHost);
    store = fixture.componentInstance.store;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    // Flush the initial auto-triggered httpResource request.
    httpMock
      .match((req) => req.url.includes('/api/v1/reviews/public/barber-ratings'))
      .forEach((req) => req.flush([]));
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should initialize with empty ratings', () => {
    expect(store.ratings()).toEqual([]);
    expect(store.errorMessage()).toBeNull();
  });

  it('should load ratings via loadRatings', async () => {
    store.loadRatings();
    fixture.detectChanges();

    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/reviews/public/barber-ratings'));
    expect(req.request.method).toBe('GET');
    req.flush(mockRatings);

    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.ratings().length).toBe(2);
    expect(store.ratings()[0].barberName).toBe('Alex the Barber');
    expect(store.ratings()[0].averageRating).toBe(4.8);
  });

  it('should surface error on HTTP failure', async () => {
    store.loadRatings();
    fixture.detectChanges();

    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/reviews/public/barber-ratings'));
    req.error(new ProgressEvent('error'), { status: 500, statusText: 'Server Error' });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.errorMessage()).toBe('Could not load barber ratings.');
  });

  it('should reload ratings on repeated calls', async () => {
    // First load
    store.loadRatings();
    fixture.detectChanges();
    httpMock
      .expectOne((r) => r.url.includes('/api/v1/reviews/public/barber-ratings'))
      .flush(mockRatings);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(store.ratings().length).toBe(2);

    // Second load
    store.loadRatings();
    fixture.detectChanges();
    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/reviews/public/barber-ratings'));
    req.flush([mockRatings[0]]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.ratings().length).toBe(1);
  });
});
