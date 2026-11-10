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
 *   detox test --configuration android.emu.release
 */

import { device, element, by, expect, waitFor } from 'detox';

// Every test starts from a cold launch. On React Native 0.88 an in-place JS reload
// (device.reloadReactNative) brings the Home ScrollView back scrolled down, so the
// hero and header assertions fail; a release build never reloads in place.
const relaunch = () => device.launchApp({ newInstance: true });
// Cold launches on hosted macOS runners vary widely (34-57 s in passing nightlies, 82 s plus a
// premature "ready" on 2026-11-01, which ran the hook past Jest's 120 s testTimeout), so the
// hook gets its own budget.
const RELAUNCH_TIMEOUT_MS = 240_000;

// Detox never scrolls by itself, and iOS does not resize the window for the keyboard: the field
// or button below the focused input sits behind it until the scroll view is moved. iOS also
// requires 100% visibility before replaceText/tap.
const scrollIntoView = (matcher: ReturnType<typeof by.id>, scrollViewId: string) =>
  waitFor(element(matcher)).toBeVisible(100).whileElement(by.id(scrollViewId)).scroll(150, 'down');

describe('Guest Booking Flow', () => {
  beforeEach(relaunch, RELAUNCH_TIMEOUT_MS);

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

  it('submits a guest booking and displays its receipt', async () => {
    const email = `detox-${Date.now()}@example.com`;
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

    // A future displayed operating day avoids the current day's last-slot cutoff. Pick an
    // actually available slot rather than assuming the wizard's default is still free.
    await element(by.id('booking-scroll-view')).scrollTo('top');
    await element(by.id(/^booking-day-/)).atIndex(1).tap();
    await waitFor(element(by.id(/^booking-slot-available-/)).atIndex(0))
      .toBeVisible()
      .whileElement(by.id('booking-scroll-view'))
      .scroll(150, 'down');
    await element(by.id(/^booking-slot-available-/)).atIndex(0).tap();

    await waitFor(element(by.text('Continue')))
      .toBeVisible()
      .whileElement(by.id('booking-scroll-view'))
      .scroll(200, 'down');
    await element(by.text('Continue')).tap();

    await expect(element(by.text('4. Contact Details & Summary'))).toBeVisible();

    // Fill in contact details using replaceText for fast, keyboard-layout-agnostic entry
    await scrollIntoView(by.id('customer-name-input'), 'booking-scroll-view');
    await element(by.id('customer-name-input')).replaceText('John Smith');
    await scrollIntoView(by.id('customer-email-input'), 'booking-scroll-view');
    await element(by.id('customer-email-input')).replaceText(email);
    await scrollIntoView(by.id('customer-phone-input'), 'booking-scroll-view');
    await element(by.id('customer-phone-input')).replaceText('15551234567');

    await waitFor(element(by.text('Confirm & Request Booking')))
      .toBeVisible()
      .whileElement(by.id('booking-scroll-view'))
      .scroll(200, 'down');
    await element(by.text('Confirm & Request Booking')).tap();
    await waitFor(element(by.text('Booking Confirmation')))
      .toBeVisible()
      .withTimeout(15000);

    // Release only this test's booking so isolated and repeated runs do not consume slots.
    const attributes = await element(by.id('receipt-booking-code')).getAttributes();
    const publicId = 'text' in attributes ? attributes.text
      : 'label' in attributes ? attributes.label : undefined;
    if (typeof publicId !== 'string' || !publicId) throw new Error('Receipt has no booking code');
    const response = await fetch(
      `http://localhost:8080/api/v1/appointments/public/cancel/${encodeURIComponent(publicId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw new Error(`Failed to release E2E booking: HTTP ${response.status}`);
  });
});

describe('Guest Login Flow', () => {
  beforeEach(relaunch, RELAUNCH_TIMEOUT_MS);

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

  it('signs in as admin and lands on the dashboard', async () => {
    await element(by.text('Sign In / Register')).tap();
    // On iOS the open keyboard covers the next control, and the scroll view shifts the content
    // to keep the focused field above it; Detox's visibility check ignores the keyboard. Close it
    // with Return after each field, as a user would. Android needs none of this (Espresso's
    // replaceText never opens the keyboard), and the IME action there swallowed the Sign In tap.
    const closeKeyboard = async (id: string) => {
      if (device.getPlatform() === 'ios') await element(by.id(id)).tapReturnKey();
    };
    await element(by.id('login-email-input')).replaceText('admin');
    await closeKeyboard('login-email-input');
    await element(by.id('login-password-input')).replaceText('admin-password');
    await closeKeyboard('login-password-input');
    await scrollIntoView(by.id('login-submit-btn'), 'login-scroll-view');
    await element(by.id('login-submit-btn')).tap();

    // The admin tab navigator replaces the guest stack once the backend accepts the login and the
    // session is written to the Keychain. On a freshly booted simulator those three writes took
    // 27 s (securityd still migrating) while the login itself answered in 450 ms.
    await waitFor(element(by.label('Logout')))
      .toBeVisible()
      .withTimeout(45000);
    await expect(element(by.text('Sign In to TaskFlow'))).not.toBeVisible();
  });
});
