/**
 * TaskFlow Mobile E2E Tests
 *
 * These tests require:
 *   1. A running native app (built with `detox build` or `npx expo run`)
 *   2. The TaskFlow backend running on localhost:8080
 *   3. An iOS Simulator or Android Emulator
 *
 * Run:
 *   detox test --configuration ios.sim.debug
 *   detox test --configuration android.emu.debug
 */

import { device, element, by, expect, waitFor } from 'detox';

describe('Guest Booking Flow', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
    });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('displays the home screen on launch', async () => {
    // The Hero section title should be visible
    await expect(element(by.text('LUXURY BARBER SCHEDULER'))).toBeVisible();
    // The Book Appointment CTA on the home screen
    await expect(element(by.id('home-book-appointment-btn'))).toBeVisible();
  });

  it('navigates to booking screen via Book tab', async () => {
    // Tap the bottom tab "Book" using testID
    await element(by.id('tab-booking')).tap();
    // The booking screen header should appear (uppercase due to textTransform)
    await waitFor(element(by.text('BOOKING ASSISTANT')))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('completes Step 1: selects a treatment', async () => {
    await element(by.id('tab-booking')).tap();
    await waitFor(element(by.text('BOOKING ASSISTANT'))).toBeVisible().withTimeout(5000);
    // Scroll down to make "Continue to Stylist" button fully visible
    await waitFor(element(by.text('Continue to Stylist')))
      .toBeVisible()
      .whileElement(by.id('booking-scroll-view'))
      .scroll(200, 'down');
    await element(by.text('Continue to Stylist')).tap();
    await expect(element(by.text('SELECT BARBER'))).toBeVisible();
  });

  it('completes Step 2: selects a barber', async () => {
    await element(by.id('tab-booking')).tap();
    await waitFor(element(by.text('BOOKING ASSISTANT'))).toBeVisible().withTimeout(5000);
    await waitFor(element(by.text('Continue to Stylist')))
      .toBeVisible()
      .whileElement(by.id('booking-scroll-view'))
      .scroll(200, 'down');
    await element(by.text('Continue to Stylist')).tap();
    await expect(element(by.text('SELECT BARBER'))).toBeVisible();

    // Scroll down to "Continue" button
    await waitFor(element(by.text('Continue')))
      .toBeVisible()
      .whileElement(by.id('booking-scroll-view'))
      .scroll(200, 'down');
    await element(by.text('Continue')).tap();
    // Step 3 appears
    await expect(element(by.text('SELECT OPERATING DAY'))).toBeVisible();
  });

  it('completes Step 3: picks a date', async () => {
    await element(by.id('tab-booking')).tap();
    await waitFor(element(by.text('BOOKING ASSISTANT'))).toBeVisible().withTimeout(5000);
    await waitFor(element(by.text('Continue to Stylist')))
      .toBeVisible()
      .whileElement(by.id('booking-scroll-view'))
      .scroll(200, 'down');
    await element(by.text('Continue to Stylist')).tap();

    await waitFor(element(by.text('Continue')))
      .toBeVisible()
      .whileElement(by.id('booking-scroll-view'))
      .scroll(200, 'down');
    await element(by.text('Continue')).tap();

    await expect(element(by.text('SELECT OPERATING DAY'))).toBeVisible();

    await waitFor(element(by.text('Continue')))
      .toBeVisible()
      .whileElement(by.id('booking-scroll-view'))
      .scroll(200, 'down');
    await element(by.text('Continue')).tap();

    // Step 4 should appear
    await expect(element(by.text('4. Contact Details & Summary'))).toBeVisible();
  });

  it('fills contact details on Step 4', async () => {
    await element(by.id('tab-booking')).tap();
    await waitFor(element(by.text('BOOKING ASSISTANT'))).toBeVisible().withTimeout(5000);
    await waitFor(element(by.text('Continue to Stylist')))
      .toBeVisible()
      .whileElement(by.id('booking-scroll-view'))
      .scroll(200, 'down');
    await element(by.text('Continue to Stylist')).tap();

    await waitFor(element(by.text('Continue')))
      .toBeVisible()
      .whileElement(by.id('booking-scroll-view'))
      .scroll(200, 'down');
    await element(by.text('Continue')).tap();

    await waitFor(element(by.text('Continue')))
      .toBeVisible()
      .whileElement(by.id('booking-scroll-view'))
      .scroll(200, 'down');
    await element(by.text('Continue')).tap();

    await expect(element(by.text('4. Contact Details & Summary'))).toBeVisible();

    // Fill in contact details using replaceText for fast, keyboard-layout-agnostic entry
    await element(by.id('customer-name-input')).replaceText('John Smith');
    await element(by.id('customer-email-input')).replaceText('john@example.com');
    await element(by.id('customer-phone-input')).replaceText('15551234567');

    await waitFor(element(by.text('Confirm & Request Booking')))
      .toBeVisible()
      .whileElement(by.id('booking-scroll-view'))
      .scroll(200, 'down');
    await expect(element(by.text('Confirm & Request Booking'))).toBeVisible();
  });
});

describe('Guest Login Flow', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
    });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('navigates to login via Sign In / Register', async () => {
    await element(by.text('Sign In / Register')).tap();
    await expect(element(by.text('Sign In to TaskFlow'))).toBeVisible();
  });

  it('shows validation for empty fields', async () => {
    await element(by.text('Sign In / Register')).tap();
    await element(by.id('login-submit-btn')).tap();
    // Should still be on login screen (no error shown because validation
    // in handleLogin silently returns)
    await expect(element(by.text('Sign In to TaskFlow'))).toBeVisible();
  });

  it('fills login form fields', async () => {
    await element(by.text('Sign In / Register')).tap();
    await element(by.id('login-email-input')).replaceText('admin');
    await element(by.id('login-password-input')).replaceText('admin-password');
    await element(by.id('login-submit-btn')).tap();
  });
});
