import { expect, test } from '@playwright/test';

/**
 * Where the booking flow sits on the page and how its date and time pickers behave. The wizard
 * used to start about 2,600 px down a phone, below a full copy of the menu, and listed every slot
 * of a day, taken or not.
 */

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the wizard is within a screen and a half, and the Book bar leads to it', async ({
    page,
  }) => {
    await page.goto('/');
    const wizard = page.locator('#booking');
    await expect(wizard.getByRole('heading', { name: /Booking Assistant/ })).toBeVisible();

    const top = await wizard.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(top).toBeLessThan(844 * 1.5);

    const bar = page.getByRole('link', { name: 'Book an appointment' });
    await expect(bar).toBeVisible();
    // Fixed to the bottom of the screen.
    const box = await bar.boundingBox();
    expect(box!.y + box!.height).toBeGreaterThan(844 - 24);

    await bar.click();
    await expect(page.getByRole('link', { name: 'Book an appointment' })).toBeHidden();
    await expect(wizard.getByRole('heading', { name: /Booking Assistant/ })).toBeInViewport();

    // Back at the top, the bar is back.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await expect(page.getByRole('link', { name: 'Book an appointment' })).toBeVisible();
  });

  test('the lookbook is a swipeable strip, not four stacked cards', async ({ page }) => {
    await page.goto('/');
    const strip = page.locator('app-lookbook button').first().locator('..');
    await expect(strip).toBeVisible();
    const scrollable = await strip.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(scrollable).toBe(true);
  });
});

test.describe('on a desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('a sticky summary follows the choices, and there is no Book bar', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Book an appointment' })).toBeHidden();

    const summary = page.locator('aside .booking-summary-card');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Scheduled: Pick a day');

    await page.click('.services-list .card:has-text("Classic Haircut")');
    await expect(summary).toContainText('Classic Haircut');
    await expect(summary).toContainText('$25.00');

    // Sticky: it stays in view while the page scrolls past the wizard's top.
    await summary.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 300));
    await expect(summary).toBeInViewport();
  });
});

test.describe('date and time pickers', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('page through the booking window; slots are free ones grouped by part of the day', async ({
    page,
  }) => {
    await page.goto('/');
    await page.click('.services-list .card:has-text("Classic Haircut")');
    await page.click('.wizard-footer-controls .btn-submit');
    await page.click('.card:has-text("Alex the Barber")');
    await page.click('.wizard-footer-controls .btn-submit');

    const chips = page.locator('.date-chip-btn');
    const earlier = page.getByRole('button', { name: 'Earlier days' });
    const later = page.getByRole('button', { name: 'Later days' });
    await expect(chips.first()).toBeVisible();
    await expect(earlier).toBeDisabled();

    const firstPage = await chips.first().textContent();
    await later.click();
    await expect(chips.first()).not.toHaveText(firstPage!);
    await expect(earlier).toBeEnabled();
    await expect(chips).toHaveCount(7);

    // A day a week or more ahead has its slots in groups, nothing struck out.
    await chips.first().click();
    const groups = page.locator('[id^="slot-group-"]');
    await expect(groups.first()).toBeVisible();
    const headings = await groups.allTextContents();
    expect(headings.map((h) => h.trim())).toEqual(expect.arrayContaining(['Morning', 'Afternoon']));
    await expect(page.getByText('Taken')).toHaveCount(0);
    await expect(page.getByText('Passed')).toHaveCount(0);
    await expect(page.locator('.time-slots-grid .slot-picker-btn').first()).toBeEnabled();
  });
});
