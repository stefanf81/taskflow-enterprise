import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { PostBookingActionsComponent } from './post-booking-actions';
import { AppointmentStore } from '../../appointment.store';

describe('PostBookingActionsComponent', () => {
  let fixture: ComponentFixture<PostBookingActionsComponent>;
  let component: PostBookingActionsComponent;
  let httpMock: HttpTestingController;
  let store: AppointmentStore;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [PostBookingActionsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(PostBookingActionsComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AppointmentStore);
    fixture.detectChanges();

    // ReviewStore's ratings resource fires eagerly; drain it.
    httpMock
      .match((req) => req.url.includes('/api/v1/reviews/public/barber-ratings'))
      .forEach((req) => req.flush([]));
  });

  afterEach(() => httpMock.verify());

  it('cancels a reservation after verifying the booking code and email', () => {
    component.cancelModel.set({ publicId: 'test-id', email: 'test@example.com' });
    component.onCancel();

    const req = httpMock.expectOne('/api/v1/appointments/public/cancel/test-id');
    expect(req.request.method).toBe('PUT');
    req.flush(null);

    expect(store.successMessage()).toBe(
      '🗑️ Reservation successfully cancelled and deleted from our calendar.',
    );
    expect(component.cancelModel().publicId).toBe('');
  });

  it('surfaces a cancellation verification failure', () => {
    component.cancelModel.set({ publicId: 'bad-id', email: 'test@example.com' });
    component.onCancel();

    httpMock
      .expectOne('/api/v1/appointments/public/cancel/bad-id')
      .error(new ProgressEvent('error'), { status: 404, statusText: 'Not Found' });

    expect(store.errorMessage()).toBe(
      'Verification failed. Please check your Booking Code and Email.',
    );
  });

  it('submits a review with the entered rating and comment', () => {
    component.reviewModel.set({
      publicId: 'test-id',
      email: 'john@example.com',
      rating: 4,
      comment: 'Great!',
    });
    component.onReview();

    const req = httpMock.expectOne('/api/v1/reviews/public/test-id');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      rating: 4,
      comment: 'Great!',
      customerEmail: 'john@example.com',
    });
    req.flush(null);

    expect(store.successMessage()).toBe('Thank you for your review! We appreciate your feedback.');
    expect(component.reviewModel().rating).toBe(5);
  });

  it('surfaces a review submission failure', () => {
    component.reviewModel.set({
      publicId: 'bad-id',
      email: 'john@example.com',
      rating: 5,
      comment: '',
    });
    component.onReview();

    httpMock
      .expectOne('/api/v1/reviews/public/bad-id')
      .error(new ProgressEvent('error'), { status: 400, statusText: 'Bad Request' });

    expect(store.errorMessage()).toBe(
      'Failed to submit review. Ensure the code is correct and the appointment is completed.',
    );
  });
});
