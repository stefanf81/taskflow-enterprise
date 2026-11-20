import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request } from '@playwright/test';

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

/**
 * Counts the page's requests still in flight, except the admin event stream (an SSE request that
 * stays open for the whole visit).
 */
function trackRequests(page: Page): () => number {
  const inFlight = new Set<Request>();
  const counted = (request: Request) => !request.url().includes('/api/v1/appointments/events');
  page.on('request', (request) => {
    if (counted(request)) inFlight.add(request);
  });
  page.on('requestfinished', (request) => inFlight.delete(request));
  page.on('requestfailed', (request) => inFlight.delete(request));
  return () => inFlight.size;
}

/**
 * Waits until the page has had no request in flight and no finite CSS animation or transition
 * running for a whole quiet window. Scanning earlier caught state changes half-way: when the
 * catalog arrives, the wizard's Next button turns enabled while still drawn at the disabled
 * opacity (0.5) and fades to 1 over the 200 ms `.btn` transition. Waiting for running animations
 * alone passed before that transition had started, and axe then flagged the half-faded, enabled
 * button for contrast (CI, intermittently; reproduced in 15 of 40 scans with the catalog held back
 * 200-300 ms, none with this wait).
 */
async function waitUntilSettled(page: Page, requestsInFlight: () => number): Promise<void> {
  const quietMs = 300;
  const deadline = Date.now() + 10_000;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    const busy =
      requestsInFlight() > 0 ||
      (await page.evaluate(() =>
        document
          .getAnimations()
          .some(
            (animation) =>
              animation.playState === 'running' &&
              animation.effect?.getComputedTiming().iterations !== Infinity,
          ),
      ));
    if (busy) quietSince = Date.now();
    else if (Date.now() - quietSince >= quietMs) return;
    await page.waitForTimeout(50);
  }
}

async function expectNoBlockingViolations(
  page: Page,
  label: string,
  requestsInFlight: () => number,
): Promise<void> {
  await waitUntilSettled(page, requestsInFlight);

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
    const requestsInFlight = trackRequests(page);
    await page.goto('/');

    await test.step('landing page', async () => {
      await expect(page.locator('h1').first()).toBeVisible();
      await expectNoBlockingViolations(page, 'landing page', requestsInFlight);
    });

    await test.step('login modal', async () => {
      await page.click('button:has-text("Owner Portal")');
      await expect(page.locator('[role="dialog"]')).toBeVisible();
      await expectNoBlockingViolations(page, 'login modal', requestsInFlight);
      await page.click('.modal-close');
      await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    });

    await test.step('admin dashboard', async () => {
      await page.click('button:has-text("Owner Portal")');
      await page.fill('#username', 'admin');
      await page.fill('#password', 'admin-password');
      await page.click('.modal-card button[type="submit"]');
      await expect(page.locator('h1').first()).toContainText('TaskFlow Owner Panel');
      await expectNoBlockingViolations(page, 'admin dashboard', requestsInFlight);
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
      await expectNoBlockingViolations(page, 'customer portal', requestsInFlight);
    });
  });
});
