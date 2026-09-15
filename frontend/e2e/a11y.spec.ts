import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Automated accessibility regression suite (axe-core, WCAG 2.x A/AA).
 *
 * Blocks the run on `serious` and `critical` violations — the severity levels
 * that map to real user blockers (missing accessible names, broken ARIA
 * references, focus traps, contrast failures on body text). `moderate`/`minor`
 * findings stay in the HTML report without gating the build.
 *
 * Rate-limit note: the backend meters every `/api/v1/auth/*` request
 * (csrf/me/login/register/logout) at 20/min per IP, and the whole E2E suite
 * shares one IP. The journeys therefore run inside a SINGLE page session so
 * the a11y gate costs 6 auth requests instead of ~11 (which previously starved
 * the functional suite and produced spurious 429s).
 *
 * Playwright's `bypassCSP` setting (see playwright.config.ts) is required so
 * the injected axe script can execute behind the production CSP.
 */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING_IMPACTS = ['serious', 'critical'];

async function expectNoBlockingViolations(page: Page, label: string): Promise<void> {
  // Let finite CSS transitions/animations settle first: axe blends in-flight
  // opacity (animate-fadeIn starts at 0) and would otherwise report bogus
  // contrast failures against half-faded text.
  await page
    .waitForFunction(
      () =>
        document.getAnimations().every((animation) => {
          const iterations = animation.effect?.getComputedTiming().iterations;
          return iterations === Infinity || animation.playState !== 'running';
        }),
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => undefined);

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const blocking = results.violations.filter((violation) =>
    BLOCKING_IMPACTS.includes(violation.impact ?? ''),
  );
  const summary = blocking.map(
    (violation) =>
      `[${violation.impact}] ${violation.id}: ${violation.help} (${violation.nodes.length} node(s)) → ` +
      violation.nodes
        .slice(0, 5)
        .map((node) => node.target.join(' '))
        .join(', '),
  );
  expect(summary, `Blocking axe violations on ${label}`).toEqual([]);
}

test.describe('Accessibility (axe-core, WCAG 2.x AA)', () => {
  test('key user journeys have no blocking violations', async ({ page }) => {
    await page.goto('/');

    await test.step('landing page', async () => {
      await expect(page.locator('h1').first()).toBeVisible();
      await expectNoBlockingViolations(page, 'landing page');
    });

    await test.step('login modal', async () => {
      await page.click('button:has-text("Owner Portal")');
      await expect(page.locator('[role="dialog"]')).toBeVisible();
      await expectNoBlockingViolations(page, 'login modal');
      await page.click('.modal-close');
      await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    });

    await test.step('admin dashboard', async () => {
      await page.click('button:has-text("Owner Portal")');
      await page.fill('#username', 'admin');
      await page.fill('#password', 'admin-password');
      await page.click('.modal-card button[type="submit"]');
      await expect(page.locator('h1').first()).toContainText('TaskFlow Owner Panel');
      await expectNoBlockingViolations(page, 'admin dashboard');
    });

    await test.step('customer portal', async () => {
      await page.click('.btn-logout');
      await expect(page.locator('h1').first()).toContainText('Luxury Barber Scheduler');

      const email = `a11y-customer-${Date.now()}@example.com`;
      const password = 'a11y-password-123';

      await page.click('button:has-text("Owner Portal")');
      await page.click('button:has-text("Need an account? Register")');
      await page.fill('#regName', 'A11y Tester');
      await page.fill('#regPhone', '+1-555-0100');
      await page.fill('#username', email);
      await page.fill('#password', password);
      await page.click('.modal-card button[type="submit"]');
      await expect(page.locator('.modal-card .alert-success')).toContainText('Account created!');

      await page.fill('#username', email);
      await page.fill('#password', password);
      await page.click('.modal-card button[type="submit"]');
      await expect(page.locator('h1').first()).toContainText('My Appointments');
      await expectNoBlockingViolations(page, 'customer portal');
    });
  });
});
