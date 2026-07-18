import { TestBed, ComponentFixture } from '@angular/core/testing';
import { App } from './app';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

describe('App Component Quality Assurance Suite', () => {
  let fixture: ComponentFixture<App>;
  let app: App;

  beforeEach(async () => {
    // Clean storage state before each test run (defensive; role is no longer trusted from storage)
    sessionStorage.removeItem('auth_role');

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(routes)],
    }).compileComponents();

    fixture = TestBed.createComponent(App);
    app = fixture.componentInstance;

    // Define mock data for seeding via HTTP flushes
    const mockServices = [
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
      {
        id: 4,
        name: 'Royal Hot Towel Shave',
        price: 22,
        durationMinutes: 30,
        category: 'beard',
        description: 'Desc',
      },
      {
        id: 5,
        name: 'The Executive Package',
        price: 40,
        durationMinutes: 60,
        category: 'combo',
        description: 'Desc',
      },
    ];

    const mockRatings = [
      { barberName: 'Alex the Barber', averageRating: 4.8, reviewCount: 12 },
      { barberName: 'Sara the Stylist', averageRating: 4.9, reviewCount: 15 },
      { barberName: 'Marcus Master Blade', averageRating: 5.0, reviewCount: 8 },
    ];

    fixture.detectChanges();

    // Flush pending httpResource initialization requests with mock seed data
    const httpMock = TestBed.inject(HttpTestingController);
    httpMock
      .match((req) => req.url.includes('/api/v1/catalog'))
      .forEach((req) => req.flush(mockServices));
    httpMock
      .match((req) => req.url.includes('/api/v1/reviews/public/barber-ratings'))
      .forEach((req) => req.flush(mockRatings));
    // The component calls /api/v1/auth/me on init to restore session. In this
    // unauthenticated default state we respond 401 so it stays logged out and
    // does not trigger further (pending) appointment-loading requests.
    httpMock
      .match((req) => req.url.includes('/api/v1/auth/me'))
      .forEach((req) => req.flush(null, { status: 401, statusText: 'Unauthorized' }));
    httpMock.match(() => true).forEach((req) => req.flush([]));
  });

  it('should compile and bootstrap the TaskFlow component cleanly', () => {
    expect(app).toBeTruthy();
  });

  it('should render the premium Lookbook and Landing elements by default when unauthenticated', async () => {
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    // Look for landing header and title
    expect(compiled.querySelector('header')).toBeTruthy();
    expect(compiled.querySelector('nav')?.textContent).toContain('TaskFlow');
    expect(compiled.querySelector('section')).toBeTruthy();
  });

  it('should initialize with step 1 and default booking options', () => {
    expect(app.activeStep()).toBe(1);
    expect(app.bookingService()).toBe('Classic Haircut');
    expect(app.bookingBarber()).toBe('No Preference (First Available)');
    expect(app.selectedCategory()).toBe('all');
  });

  it('should calculate the 7-day upcoming booking carousel dynamically, skipping Sundays', () => {
    const days = app.upcomingBookingDays();

    // Assert exactly 7 booking days are generated
    expect(days.length).toBe(7);

    // Verify no Sunday (dayName !== 'Sun') is present in the computed list
    const hasSunday = days.some((d) => d.dayName === 'Sun');
    expect(hasSunday).toBe(false);

    // Assert that each day contains a valid YYYY-MM-DD string representation
    days.forEach((day) => {
      expect(day.dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(day.dayNum).toBeGreaterThan(0);
      expect(day.dayNum).toBeLessThan(32);
    });
  });

  it('should dynamically filter services based on category tabs', () => {
    // Default category 'all' should return all services
    app.setServiceCategory('all');
    expect(app.filteredServices().length).toBe(app.services().length);

    // Filter by 'hair' category should return only haircut packages
    app.setServiceCategory('hair');
    const hairServices = app.filteredServices();
    expect(hairServices.length).toBe(2); // Classic Haircut & Skin Fade
    hairServices.forEach((s) => expect(s.category).toBe('hair'));

    // Filter by 'beard' category should return only shave packages
    app.setServiceCategory('beard');
    const beardServices = app.filteredServices();
    expect(beardServices.length).toBe(2); // Beard Trim & Royal Shave
    beardServices.forEach((s) => expect(s.category).toBe('beard'));
  });

  it('should enforce step validation rules for guided wizard progression', () => {
    // STEP 1 is valid because a service is selected by default
    expect(app.isStepValid(1)).toBe(true);

    // Select a blank service to verify step 1 invalidation
    app.selectService('');
    expect(app.isStepValid(1)).toBe(false);

    // Restore service
    app.selectService('Classic Haircut');
    expect(app.isStepValid(1)).toBe(true);

    // STEP 2 is valid because No Preference barber is selected by default
    expect(app.isStepValid(2)).toBe(true);

    // STEP 3 requires a date and time slot to be valid
    expect(app.isStepValid(3)).toBe(false); // Invalid initially

    app.bookingModel.update((m) => ({ ...m, bookingDate: '2026-06-25', bookingTime: '10:00' }));
    expect(app.isStepValid(3)).toBe(true); // Valid now

    // If the selected slot is busy/taken, step 3 should be invalidated
    app.busySlots.set(['10:00']);
    expect(app.isStepValid(3)).toBe(false);
  });

  it('should compute real-time itemized checkout subtotals, fees, and totals dynamically', () => {
    // Choose Classic Haircut ($25)
    app.selectService('Classic Haircut');
    expect(app.checkoutSubtotal()).toBe(25);
    expect(app.checkoutFee()).toBe(2.5);
    expect(app.checkoutTotal()).toBe(27.5);

    // Choose The Executive Package ($40)
    app.selectService('The Executive Package');
    expect(app.checkoutSubtotal()).toBe(40);
    expect(app.checkoutFee()).toBe(2.5);
    expect(app.checkoutTotal()).toBe(42.5);
  });

  it('should translate 24-hour database representations into beautiful 12-hour AM/PM formats', () => {
    expect(app.formatTime12Hour('09:00')).toBe('9:00 AM');
    expect(app.formatTime12Hour('13:00')).toBe('1:00 PM');
    expect(app.formatTime12Hour('12:00')).toBe('12:00 PM');
    expect(app.formatTime12Hour('15:30')).toBe('3:30 PM');
  });

  it('should compute the estimated completion end time based on service duration', () => {
    // Select Classic Haircut (30 mins duration)
    app.bookingModel.update((m) => ({
      ...m,
      serviceType: 'Classic Haircut',
      bookingTime: '10:00',
    })); // 10:00 AM
    expect(app.estimatedEndTime()).toBe('10:30'); // represented as 10:30 (24h)

    // Select Skin Fade (45 mins duration)
    app.bookingModel.update((m) => ({
      ...m,
      serviceType: 'Modern Skin Fade',
      bookingTime: '13:15',
    })); // 01:15 PM
    expect(app.estimatedEndTime()).toBe('14:00'); // represented as 14:00 (02:00 PM)
  });

  it('should manage interactive FAQ expand/collapse toggle states', () => {
    // Initially, no FAQ is active (collapsed)
    expect(app.activeFaq()).toBeNull();

    // Toggle first FAQ
    app.toggleFaq(0);
    expect(app.activeFaq()).toBe(0);

    // Toggle same FAQ again to collapse it
    app.toggleFaq(0);
    expect(app.activeFaq()).toBeNull();

    // Toggle different FAQ
    app.toggleFaq(2);
    expect(app.activeFaq()).toBe(2);
  });

  it('should support non-HTTP simple helper methods', () => {
    app.setAdminView('notifications');
    expect(app.adminView()).toBe('notifications');

    app.setAdminView('schedules');
    expect(app.adminView()).toBe('schedules');

    expect(app.isOverdue({ bookingDate: '2020-01-01' } as any)).toBe(true);
    expect(app.isOverdue({ bookingDate: '2099-12-31' } as any)).toBe(false);
    expect(app.isOverdue({} as any)).toBe(false);

    app.selectStylist('Sara the Stylist');
    expect(app.bookingBarber()).toBe('Sara the Stylist');

    app.selectLookbookStyle('Classic Haircut', 'hair');
    expect(app.bookingService()).toBe('Classic Haircut');
    expect(app.selectedCategory()).toBe('hair');
    expect(app.activeStep()).toBe(2);
  });

  it('should support onLogout', () => {
    // A1.2: role lives only in memory (AuthState), never in sessionStorage.
    app.onLogout();
    expect(app.userRole()).toBe('');
    expect(sessionStorage.getItem('auth_role')).toBeNull();
  });

  it('should validate step 4 correctly', () => {
    app.bookingModel.update((m) => ({
      ...m,
      customerName: 'Test User',
      customerEmail: 'test@example.com',
      customerPhone: '1234567890',
    }));
    expect(app.isStepValid(4)).toBe(true);

    app.bookingModel.update((m) => ({ ...m, customerName: '' }));
    expect(app.isStepValid(4)).toBe(false);
  });

  it('should handle onLogin success and failure', () => {
    const httpMock = TestBed.inject(HttpTestingController);

    // failure path
    app.loginUsername = 'wrong';
    app.loginPassword = 'wrong-password';
    app.onLogin();

    let reqs = httpMock.match((req) => req.url.includes('/api/v1/auth/login'));
    expect(reqs.length).toBe(1);
    reqs[0].error(new ProgressEvent('error'), { status: 401, statusText: 'Unauthorized' });
    expect(app.errorMessage()).toBe('Invalid credentials. Please try again.');

    // success path
    app.loginUsername = 'admin';
    app.loginPassword = 'admin-password';
    app.onLogin();

    reqs = httpMock.match((req) => req.url.includes('/api/v1/auth/login'));
    expect(reqs.length).toBe(1);
    reqs[0].flush({ username: 'admin', role: 'ROLE_ADMIN' });
    expect(app.isLoggedIn()).toBe(true);
    expect(app.userRole()).toBe('ROLE_ADMIN');
    // A1.2: role must NOT be persisted to sessionStorage
    expect(sessionStorage.getItem('auth_role')).toBeNull();
  });

  it('should handle onRegister success and failure', () => {
    const httpMock = TestBed.inject(HttpTestingController);

    app.isRegisterMode = true;
    app.loginUsername = 'newuser@example.com';
    app.loginPassword = 'password123';
    app.registerFullName = 'New User';
    app.registerPhone = '555-1234';

    app.onLogin(); // triggers onRegister when isRegisterMode is true

    let reqs = httpMock.match((req) => req.url.includes('/api/v1/auth/register'));
    expect(reqs.length).toBe(1);
    reqs[0].flush({ message: 'Success' });

    expect(app.isRegisterMode).toBe(false);
    expect(app.successMessage()).toBe('Account created! You can now log in.');

    // error path
    app.isRegisterMode = true;
    app.loginUsername = 'newuser2@example.com';
    app.loginPassword = 'password123';
    app.registerFullName = 'New User 2';
    app.registerPhone = '555-1234';

    app.onLogin();
    reqs = httpMock.match((req) => req.url.includes('/api/v1/auth/register'));
    expect(reqs.length).toBe(1);
    reqs[0].error(new ProgressEvent('error'), { status: 400, statusText: 'Bad Request' });
    expect(app.errorMessage()).toBe('Failed to create account.');
  });

  it('should handle onPublicCancel success and failure', () => {
    const httpMock = TestBed.inject(HttpTestingController);

    app.cancelBookingId = 'test-id';
    app.cancelEmail = 'test@example.com';
    app.onPublicCancel();

    let reqs = httpMock.match((req) =>
      req.url.includes('/api/v1/appointments/public/cancel/test-id'),
    );
    expect(reqs.length).toBe(1);
    expect(reqs[0].request.method).toBe('PUT');
    reqs[0].flush(null);

    expect(app.successMessage()).toBe(
      '🗑️ Reservation successfully cancelled and deleted from our calendar.',
    );
    expect(app.cancelBookingId).toBe('');
    expect(app.cancelEmail).toBe('');

    // error path
    app.cancelBookingId = 'bad-id';
    app.cancelEmail = 'test@example.com';
    app.onPublicCancel();

    reqs = httpMock.match((req) => req.url.includes('/api/v1/appointments/public/cancel/bad-id'));
    expect(reqs.length).toBe(1);
    reqs[0].error(new ProgressEvent('error'), { status: 404, statusText: 'Not Found' });
    expect(app.errorMessage()).toBe(
      'Verification failed. Please check your Booking Code and Email.',
    );
  });

  it('should handle submitReview success and failure', () => {
    const httpMock = TestBed.inject(HttpTestingController);

    app.reviewPublicId = 'test-id';
    app.reviewRating = 4;
    app.reviewComment = 'Great!';
    app.submitReview();

    let reqs = httpMock.match((req) => req.url.includes('/api/v1/reviews/public/test-id'));
    expect(reqs.length).toBe(1);
    expect(reqs[0].request.method).toBe('POST');
    expect(reqs[0].request.body).toEqual({ rating: 4, comment: 'Great!' });
    reqs[0].flush(null);

    expect(app.successMessage()).toBe('Thank you for your review! We appreciate your feedback.');
    expect(app.reviewPublicId).toBe('');
    expect(app.reviewComment).toBe('');

    // error path
    app.reviewPublicId = 'bad-id';
    app.submitReview();

    reqs = httpMock.match((req) => req.url.includes('/api/v1/reviews/public/bad-id'));
    expect(reqs.length).toBe(1);
    reqs[0].error(new ProgressEvent('error'), { status: 400, statusText: 'Bad Request' });
    expect(app.errorMessage()).toBe(
      'Failed to submit review. Ensure the code is correct and the appointment is completed.',
    );
  });
});
