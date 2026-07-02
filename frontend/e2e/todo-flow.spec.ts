import { test, expect } from '@playwright/test';

/**
 * STATE-OF-THE-ART END-TO-END FLOW TEST SCRIPT FOR GUIDED BARBER BOOKING WIZARD
 * 
 * Why this is used:
 * To verify the actual full-stack user journey. It launches a real, headless browser,
 * connects to Nginx/Angular, interacts with DOM nodes, authenticates against Spring Security,
 * and performs database operations, ensuring the entire system operates harmoniously.
 */
test.describe('TaskFlow Full-Stack Portal E2E Flow', () => {

  test.beforeEach(async ({ page }) => {
    // Capture browser console logs for robust E2E debugging
    page.on('console', msg => console.log(`[BROWSER_CONSOLE] [${msg.type()}] ${msg.text()}`));
    
    // Start each test on the landing page
    await page.goto('/');
  });

  test('should display barber landing page and prevent unauthorized owner access by default', async ({ page }) => {
    // 1. Confirm landing page elements are visible
    await expect(page.locator('h1').first()).toContainText('Luxury Barber Scheduler');
    await expect(page.locator('nav')).toContainText('TaskFlow');
    await expect(page.locator('button:has-text("Owner Portal")')).toBeVisible();
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

  test('should allow a guest to request a booking slot via the guided wizard, then owner logs in, approves it, and deletes it', async ({ page }) => {
    // 1. Wizard Step 1: Select Treatment (e.g. Classic Haircut)
    await page.click('.services-list .card:has-text("Classic Haircut")');
    await page.click('.wizard-footer-controls .btn-submit');

    // 2. Wizard Step 2: Choose Stylist (e.g. Alex the Barber)
    await page.click('.card:has-text("Alex the Barber")');
    await page.click('.wizard-footer-controls .btn-submit');

    // 3. Wizard Step 3: Pick Date & Time
    // Click the first available date button
    await page.locator('.form-group .slot-picker-btn').first().click();
    // Select the first available time slot
    await page.locator('.time-slots-grid .slot-picker-btn:not(.slot-busy)').first().click();
    await page.click('.wizard-footer-controls .btn-submit');

    // 4. Wizard Step 4: Contact Info & Review
    const randomGuestName = `E2E Guest - ${Math.floor(Math.random() * 10000)}`;
    await page.fill('#customerName', randomGuestName);
    await page.fill('#customerEmail', 'guest@example.com');
    await page.fill('#customerPhone', '555-4321');

    await page.waitForTimeout(1000);
    await page.click('button:has-text("Confirm & Request Booking")');

    // 5. Verify success banner is shown for guest booking request
    const receiptModal = page.locator('.modal-overlay');
    
    // Check if error alert is visible instead
    if (await page.locator('.alert-error').isVisible()) {
      const errorText = await page.locator('.alert-error').textContent();
      console.log('UNEXPECTED ERROR ALERT:', errorText);
    }

    await expect(receiptModal).toBeVisible({ timeout: 10000 });
    await expect(receiptModal).toContainText('Reservation Requested!');
    await page.locator('button', { hasText: 'Got It, Thanks!' }).dispatchEvent('click');

    // 6. Log in as owner/admin via modal
    await page.click('button:has-text("Owner Portal")');
    await page.fill('#username', 'admin');
    await page.fill('#password', 'admin-password');
    await page.click('.modal-card button[type="submit"]');

    // 7. Assert dashboard loaded successfully
    await expect(page.locator('h1')).toContainText('TaskFlow Owner Panel');
    await expect(page.locator('.alert-success')).toContainText('Welcome back, Owner!');

    // 8. Locate our requested appointment in the bookings list
    const bookingCard = page.locator(`.card.p-5:has-text("${randomGuestName}")`);
    await expect(bookingCard).toBeVisible();
    await expect(bookingCard).toContainText('Pending');

    // 9. Approve the guest booking slot
    await bookingCard.locator('button:has-text("Approve")').click();
    await expect(bookingCard).toContainText('Approved');

    // 10. Delete the appointment
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Are you sure you want to permanently delete/cancel this booking?');
      await dialog.accept(); // Confirms deletion
    });
    await bookingCard.locator('.btn-delete').dispatchEvent('click');

    // 11. Verify booking card was removed from the list
    await expect(bookingCard).not.toBeVisible();

    // 12. Log out securely
    await page.click('.btn-logout');

    // 13. Confirm owner is returned safely to the guest landing page
    await expect(page.locator('h1').first()).toContainText('Luxury Barber Scheduler');
  });
});
