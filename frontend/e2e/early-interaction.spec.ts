import { expect, test } from '@playwright/test';

/**
 * The guest landing is prerendered, so its controls are on screen before main.js has run. On a
 * real network that window lasts a second or more, and a click made in it must not be lost:
 * Angular's event replay queues it and delivers it once the code has loaded.
 *
 * It was lost for the lookbook and the FAQ while their `@defer` blocks hydrated on idle
 * (BENCHMARKS.md §70): the production smoke test (k6/browser.js) clicked a lookbook card as soon
 * as it was visible and the wizard never left step 1. This suite did not notice, because the
 * bundle arrives within milliseconds of the HTML here. These tests hold the scripts back
 * instead.
 */
test.describe('Clicks made before the page has hydrated', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/*.js', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('a lookbook card still advances the wizard to the stylist step', async ({ page }) => {
    await page.locator('app-lookbook button:has-text("Executive Pompadour")').click();

    await expect(page.locator('.wizard-step-node.active')).toHaveText('2');
    await expect(page.locator('.alert-success')).toContainText(
      'Lookbook Style selected: Classic Haircut',
    );
  });

  test('an FAQ question still expands', async ({ page }) => {
    const question = page.locator(
      'button:has-text("How early should I arrive for my appointment?")',
    );
    await question.click();

    await expect(question).toHaveAttribute('aria-expanded', 'true');
    await expect(
      page.locator('p:has-text("We recommend arriving 5–10 minutes early.")'),
    ).toBeVisible();
  });
});
