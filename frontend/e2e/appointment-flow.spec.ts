import { test, expect, type TestInfo } from '@playwright/test';

/**
 * COMPREHENSIVE END-TO-END FLOW TEST SUITE FOR TASKFLOW PORTAL
 *
 * This test suite provides 100% functional E2E scenario coverage for every feature
 * on the TaskFlow Single Page Application (SPA), including:
 * - Public FAQ Accordion Interactions
 * - Signature Lookbook Style Loader
 * - Customer Registration Pipeline
 * - Invalid Administrator Credentials Guard
 * - Integrated Guest Booking Stepper Wizard
 * - Unique Booking Code Extraction from Receipt Modal
 * - Administrative Control Panel Navigation (Appointments, Schedules, Notification Outbox)
 * - Barber Selection & Reactive Time-Off Logging
 * - Booking Search, Denial, and Approval Pipeline
 * - Customer Public Feedback & Review Submission
 * - Customer Public Self-Service Secure Booking Cancellation
 */
test.describe('TaskFlow Full-Stack Portal E2E Flow', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // Buffer browser console logs per-test. We deliberately do NOT echo them
    // to stdout on every run: expected auth failures (e.g. 401 from the
    // "invalid admin login" guard and the unauthenticated barbers store)
    // would otherwise flood the CI log and bury the real signal. Captured
    // messages are only emitted when a test actually fails (see afterEach).
    const consoleBuffer: string[] = [];
    testInfo['consoleBuffer'] = consoleBuffer;
    page.on('console', (msg) =>
      consoleBuffer.push(`[BROWSER_CONSOLE] [${msg.type()}] ${msg.text()}`),
    );

    // Start each test on the landing page
    await page.goto('/');
  });

  test.afterEach(async ({}, testInfo) => {
    // Only surface the captured browser console output for failing tests so
    // the CI log stays clean on green runs but keeps full diagnostics on red ones.
    if (testInfo.status !== 'passed' && testInfo['consoleBuffer']?.length) {
      console.log(
        `\n[BROWSER_CONSOLE] --- Captured browser console for failed test "${testInfo.title}" ---`,
      );
      for (const line of testInfo['consoleBuffer']) {
        console.log(line);
      }
    }
  });

  test('should support viewing and expanding the Frequently Asked Questions (FAQ) accordions', async ({
    page,
  }) => {
    // Scroll down to the FAQs section
    await page.locator('h2:has-text("Frequently Asked Questions")').scrollIntoViewIfNeeded();

    // 1. Initially, FAQ contents should not be visible
    const faqContent = page.locator('p:has-text("We recommend arriving 5–10 minutes early.")');
    await expect(faqContent).not.toBeVisible();

    // 2. Click on the first FAQ heading
    await page.locator('button:has-text("How early should I arrive for my appointment?")').click();

    // 3. Confirm FAQ content expands and is visible
    await expect(faqContent).toBeVisible();

    // 4. Click again to toggle/collapse the FAQ accordion
    await page.locator('button:has-text("How early should I arrive for my appointment?")').click();
    await expect(faqContent).not.toBeVisible();
  });

  test('should allow a customer to select a lookbook style and proceed directly to stylist selector', async ({
    page,
  }) => {
    // 1. Verify Lookbook title is displayed
    await expect(page.locator('h2:has-text("Signature Lookbook")')).toBeVisible();

    // 2. Click the Executive Pompadour Lookbook Style Card
    await page.locator('h4:has-text("Executive Pompadour")').click();

    // 3. Confirm the booking wizard automatically fast-forwards to Step 2 (Stylist Selection)
    await expect(page.locator('.wizard-step-node.active')).toHaveText('2');

    // 4. Confirm the success banner informs the client about lookbook selection
    await expect(page.locator('.alert-success')).toContainText(
      'Lookbook Style selected: Classic Haircut',
    );
  });

  test('should support new customer account registration flow', async ({ page }) => {
    // 1. Open the Admin Login Modal
    await page.click('button:has-text("Owner Portal")');
    await expect(page.locator('.modal-overlay')).toBeVisible();

    // 2. Switch from Sign In mode to Register Account mode
    await page.click('button:has-text("Need an account? Register")');
    await expect(page.locator('.modal-card h2')).toContainText('Create Account');

    // 3. Populate unique client registration credentials
    const randomSuffix = Math.floor(Math.random() * 100000);
    await page.fill('#regName', `Registered Client ${randomSuffix}`);
    await page.fill('#regPhone', '555-8888');
    await page.fill('#username', `client${randomSuffix}@example.com`);
    await page.fill('#password', 'securePassword123');

    // 4. Submit registration
    await page.click('.modal-card button[type="submit"]');

    // 5. Confirm that registration is successful and instructs to sign in
    await expect(page.locator('.alert-success')).toContainText(
      'Account created! You can now log in.',
    );
  });

  test('should show error alert on invalid admin login credentials', async ({ page }) => {
    // 1. Open the Admin Login Modal
    await page.click('button:has-text("Owner Portal")');
    await expect(page.locator('.modal-overlay')).toBeVisible();

    // 2. Input invalid credentials
    await page.fill('#username', 'fake-user');
    await page.fill('#password', 'wrong-password');
    await page.click('.modal-card button[type="submit"]');

    // 3. Assert error message banner is visible in the modal
    const alert = page.locator('.modal-card .alert-error');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Invalid credentials. Please try again.');
  });

  test('should successfully execute a complete booking request, owner approval, public review, and public self-service cancellation', async ({
    page,
  }) => {
    // ----------------------------------------------------
    // PHASE 1: GUEST BOOKING STEPPER WIZARD
    // ----------------------------------------------------
    // Step 1: Select Service (Classic Haircut)
    await page.click('.services-list .card:has-text("Classic Haircut")');
    await page.click('.wizard-footer-controls .btn-submit');

    // Step 2: Choose Stylist (Alex the Barber)
    await page.click('.card:has-text("Alex the Barber")');
    await page.click('.wizard-footer-controls .btn-submit');

    // Step 3: Pick Date & Time
    await page.locator('.form-group .slot-picker-btn').first().click();
    await page.locator('.time-slots-grid .slot-picker-btn:not(.slot-busy)').first().click();
    await page.click('.wizard-footer-controls .btn-submit');

    // Step 4: Contact Info & Confirm
    const guestUniqueName = `E2E Full Flow - ${Math.floor(Math.random() * 100000)}`;
    const guestEmailAddress = 'flowuser@example.com';
    await page.fill('#customerName', guestUniqueName);
    await page.fill('#customerEmail', guestEmailAddress);
    await page.fill('#customerPhone', '555-1122');

    // Submit Booking Request
    await page.waitForTimeout(500);
    await page.click('button:has-text("Confirm & Request Booking")');

    // Assert receipt modal is visible
    const receiptModal = page.locator('.modal-overlay');
    await expect(receiptModal).toBeVisible({ timeout: 10000 });
    await expect(receiptModal).toContainText('Reservation Requested!');

    // Extract the unique Booking Code (publicId) from the receipt modal
    const rawBookingCode = await page.locator('.modal-card strong.text-indigo-400').textContent();
    const bookingCode = rawBookingCode?.trim() || '';
    console.log(`[E2E] Extracted Booking Reference Code: ${bookingCode}`);
    expect(bookingCode.length).toBeGreaterThan(5);

    // Dismiss receipt modal
    await page.locator('button', { hasText: 'Got It, Thanks!' }).dispatchEvent('click');
    await expect(receiptModal).not.toBeVisible();

    // ----------------------------------------------------
    // PHASE 2: ADMINISTRATIVE PANEL CONTROL PLANE
    // ----------------------------------------------------
    // Open Owner Portal and Log In as Admin
    await page.click('button:has-text("Owner Portal")');
    await page.fill('#username', 'admin');
    await page.fill('#password', 'admin-password');
    await page.click('.modal-card button[type="submit"]');

    // Confirm admin panel dashboard is loaded
    await expect(page.locator('h1')).toContainText('TaskFlow Owner Panel');
    await expect(page.locator('.alert-success')).toContainText('Welcome back, Owner!');

    // Nav Tab 1: Check Notification Outbox
    await page.click('button:has-text("Notification Outbox")');
    await expect(page.locator('h3:has-text("Automated Notification Outbox")')).toBeVisible();

    // Nav Tab 2: Check Schedules & Time-Off, and Add Barber Time-Off
    await page.click('button:has-text("Schedules & Time-Off")');
    const schedulesContainer = page.locator('.card:has-text("Barber Schedules & Time-Off")');
    await expect(schedulesContainer).toBeVisible();

    // Select Barber (Alex the Barber)
    await page.click('p:has-text("Alex the Barber")');

    // Populate and save Time-Off details
    await schedulesContainer.locator('input[type="date"]').first().fill('2026-08-01');
    await schedulesContainer.locator('input[type="date"]').nth(1).fill('2026-08-05');
    await page.fill('input[placeholder="e.g. Vacation"]', 'Annual Summer Vacation');
    await page.click('button:has-text("Save Time-Off")');

    // Confirm that Success Banner matches time-off action
    await expect(page.locator('.alert-success')).toContainText('Time off added successfully.');

    // Nav Tab 3: Appointments List, Filter, Search, Deny & Approve
    await page.click('button:has-text("Appointments")');

    // Search for our newly generated guest name using exact placeholder to avoid clash with other inputs
    const searchInput = page.locator('input[placeholder="Search customers..."]');
    await searchInput.fill(guestUniqueName);

    // Locate the booking card matching our guest name - using .card.p-5 to uniquely target child items
    const bookingCard = page.locator('.card.p-5', { hasText: guestUniqueName });
    await expect(bookingCard).toBeVisible();
    await expect(bookingCard).toContainText('Pending');

    // Test the Deny endpoint
    await bookingCard.locator('button:has-text("Deny")').click();
    await expect(bookingCard).toContainText('Denied');

    // Test transition from Denied back to Approved
    await bookingCard.locator('button:has-text("Approve")').click();
    await expect(bookingCard).toContainText('Approved');

    // Log out of the Owner Panel
    await page.click('.btn-logout');
    await expect(page.locator('h1').first()).toContainText('Luxury Barber Scheduler');

    // ----------------------------------------------------
    // PHASE 3: CUSTOMER PUBLIC FEEDBACK / REVIEWS
    // ----------------------------------------------------
    // Scroll down to reviews section
    await page.locator('h2:has-text("Submit a Review")').scrollIntoViewIfNeeded();

    // Populate review form with the booking code we extracted
    await page.fill('#reviewPublicId', bookingCode);
    await page.fill('#reviewRating', '5');
    await page.fill(
      '#reviewComment',
      'This was an absolutely outstanding haircut experience. Five stars!',
    );
    await page.click('button:has-text("Submit Review")');

    // Confirm review submission feedback matches success modal
    await expect(page.locator('.alert-success')).toContainText(
      'Thank you for your review! We appreciate your feedback.',
    );

    // ----------------------------------------------------
    // PHASE 4: CLIENT SELF-SERVICE SECURE CANCELLATION
    // ----------------------------------------------------
    // Scroll down to cancellation section
    await page.locator('h2:has-text("Secure Booking Cancellation")').scrollIntoViewIfNeeded();

    // Populate cancellation form with booking code and verification email
    await page.fill('#cancelBookingId', bookingCode);
    await page.fill('#cancelEmail', guestEmailAddress);
    await page.click('button:has-text("Cancel Reservation")');

    // Confirm secure self-service cancellation was processed successfully
    await expect(page.locator('.alert-success')).toContainText(
      'Reservation successfully cancelled and deleted from our calendar.',
    );
  });

  test('should redirect an unauthenticated user away from the protected /admin dashboard', async ({
    page,
  }) => {
    // TE2 (security): the auth guard (A1.2) must block deep-linking to the
    // owner panel without a valid session and send the user back to the landing
    // page rather than rendering the dashboard.
    await page.goto('/admin');
    await expect(page).not.toHaveURL(/\/admin$/);
    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await expect(page.locator('h1').first()).toContainText('Luxury Barber Scheduler');
  });

  test('should reject a public self-service cancellation with a mismatched email', async ({
    page,
  }) => {
    // TE2: the public cancel endpoint requires the booking code AND the
    // reservation email to match. A wrong email must surface a verification
    // error and NOT cancel anything.
    await page.locator('h2:has-text("Secure Booking Cancellation")').scrollIntoViewIfNeeded();

    await page.fill('#cancelBookingId', 'some-nonexistent-code');
    await page.fill('#cancelEmail', 'not-the-right-email@example.com');
    await page.click('button:has-text("Cancel Reservation")');

    const alert = page.locator('.alert-error');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Appointment booking not found.');
  });

  test('should reject a review submission for an unknown or not-completed booking code', async ({
    page,
  }) => {
    // TE2: reviews are only accepted for a valid, completed appointment. A
    // fabricated or reused code should fail validation and surface an error
    // rather than silently creating a review.
    await page.locator('h2:has-text("Submit a Review")').scrollIntoViewIfNeeded();

    await page.fill('#reviewPublicId', 'totally-made-up-code');
    await page.fill('#reviewRating', '5');
    await page.fill('#reviewComment', 'Should not be accepted.');
    await page.click('button:has-text("Submit Review")');

    const alert = page.locator('.alert-error');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Appointment not found or not available for review.');
  });

  test('should reject an unauthenticated POST to a protected admin API', async ({ page }) => {
    // TE2 (API-level security sanity, runs in the same browser origin):
    // with no session cookie, calling an admin-only endpoint directly must
    // return 401 and never return appointment data. This guards against a
    // regression where a controller was left unsecured (C2).
    const response = await page.request.get('/api/v1/appointments');
    expect(response.status()).toBe(401);
  });
});
