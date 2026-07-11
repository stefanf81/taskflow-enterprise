import { TestBed, ComponentFixture } from '@angular/core/testing';
import { App } from './app';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';

describe('App Component Quality Assurance Suite', () => {
  let fixture: ComponentFixture<App>;
  let app: App;

  beforeEach(async () => {
    // Clean storage state before each test run
    sessionStorage.removeItem('auth_token');

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(App);
    app = fixture.componentInstance;

    // Seed the catalog store with mock data for testing
    app['catalogStore'].services.set([
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
    ]);

    fixture.detectChanges();

    // Flush any pending httpResource initialization requests to prevent whenStable() from hanging
    const httpMock = TestBed.inject(HttpTestingController);
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
    app.bookingService.set('');
    expect(app.isStepValid(1)).toBe(false);

    // Restore service
    app.bookingService.set('Classic Haircut');
    expect(app.isStepValid(1)).toBe(true);

    // STEP 2 is valid because No Preference barber is selected by default
    expect(app.isStepValid(2)).toBe(true);

    // STEP 3 requires a date and time slot to be valid
    expect(app.isStepValid(3)).toBe(false); // Invalid initially

    app.bookingDate.set('2026-06-25');
    app.bookingTime.set('10:00');
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
    app.bookingService.set('Classic Haircut');
    app.bookingTime.set('10:00'); // 10:00 AM
    expect(app.estimatedEndTime()).toBe('10:30'); // represented as 10:30 (24h)

    // Select Skin Fade (45 mins duration)
    app.bookingService.set('Modern Skin Fade');
    app.bookingTime.set('13:15'); // 01:15 PM
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
});
