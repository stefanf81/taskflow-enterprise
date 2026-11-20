import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The guest landing's first paint is the prerendered HTML, so what the browser adds to it later
 * must neither move it nor hide it from Largest Contentful Paint (BENCHMARKS.md §72). The same
 * goes for the signed-in pages' first render.
 */

/**
 * The elements that run a CSS animation: `scope` itself, its ancestors and, with `descendants`,
 * everything inside it. Chrome does not report a transparent element as FCP or LCP, so a fade-in
 * on any of them hides the page's first paint from both metrics.
 */
function animatedAround(scope: Locator, { descendants = false } = {}): Promise<string[]> {
  return scope.evaluate((element, withDescendants) => {
    const elements: Element[] = [element];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      elements.push(parent);
    }
    if (withDescendants) elements.push(...Array.from(element.querySelectorAll('*')));
    return elements
      .filter((candidate) => getComputedStyle(candidate).animationName !== 'none')
      .map((candidate) => `${candidate.tagName.toLowerCase()}.${candidate.className}`);
  }, descendants);
}

/** Posts to an auth endpoint as the web app does: the CSRF cookie first, then its header. */
async function postAuth(page: Page, path: string, data: Record<string, string>): Promise<void> {
  await page.request.get('/api/v1/auth/csrf');
  const token =
    (await page.context().cookies()).find((cookie) => cookie.name === 'XSRF-TOKEN')?.value ?? '';
  const response = await page.request.post(`/api/v1/auth/${path}`, {
    data,
    headers: { 'X-XSRF-TOKEN': token },
  });
  expect(response.ok(), `POST /api/v1/auth/${path}: HTTP ${response.status()}`).toBe(true);
}

test.describe('Landing page stability', () => {
  test('the open/closed badge does not shift the page on a phone', async ({ page }) => {
    // Below 430 px the nav wraps once the badge is in it. The badge waits for /public/shop, so
    // on a slow link it used to arrive after first paint and push the page down 28 px (CLS 0.09).
    await page.setViewportSize({ width: 390, height: 844 });
    let shopAnswered = false;
    await page.route('**/api/v1/appointments/public/shop', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      shopAnswered = true;
      await route.continue();
    });
    await page.addInitScript(() => {
      const w = window as unknown as { __shifts: { at: number; value: number }[] };
      w.__shifts = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          startTime: number;
          value: number;
          hadRecentInput: boolean;
        }[]) {
          if (!entry.hadRecentInput) w.__shifts.push({ at: entry.startTime, value: entry.value });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    /** Layout-shift entries are reported after the frame that caused them. */
    const nextFrames = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );

    await page.goto('/');
    // Only what the shop answer moves is measured here. The web-font swap shifts the page too,
    // by an amount that depends on the machine's fallback font (CLS 0.02-0.03 with DejaVu Sans,
    // none where Inter is installed locally; BENCHMARKS.md §72), so it has to be over first.
    const fontsSettledAt = await page.evaluate(async () => {
      await document.fonts.ready;
      return performance.now();
    });
    await nextFrames();
    expect(shopAnswered, 'the shop hours arrived before the web font had loaded').toBe(false);

    await expect(page.locator('nav').getByText(/● (Shop Open|Closed Now)/)).toBeVisible();
    await nextFrames();

    const cls = await page.evaluate(
      (since) =>
        (window as unknown as { __shifts: { at: number; value: number }[] }).__shifts
          .filter((shift) => shift.at >= since)
          .reduce((sum, shift) => sum + shift.value, 0),
      fontsSettledAt,
    );
    expect(cls).toBeLessThan(0.01);
  });

  test('the hero has no entrance animation', async ({ page }) => {
    // The hero's heading and intro are the LCP element. Chrome does not report an element while it
    // is transparent, so a fade-in from opacity 0 moved LCP to the next repaint of the text (the
    // web font swap): 1.6 s instead of 0.7 s on slow 4G, although the fade itself lasts 250 ms.
    await page.goto('/');
    const hero = page.locator('header', { hasText: 'Luxury Barber' });
    await expect(hero).toBeVisible();

    expect(await animatedAround(hero, { descendants: true })).toEqual([]);
  });
});

test.describe('Signed-in pages', () => {
  test('have no entrance animation around their heading', async ({ page }) => {
    // The admin dashboard, customer portal and booking page used to fade in as a whole, so their
    // FCP and LCP were the first paint after the data arrived, not the page (BENCHMARKS.md §73).
    await postAuth(page, 'login', { username: 'admin', password: 'admin-password' });
    await page.goto('/admin');
    const heading = page.locator('h1').first();
    await expect(heading).toContainText('TaskFlow Owner Panel');
    expect(await animatedAround(heading)).toEqual([]);

    await page.context().clearCookies();
    const email = `stability-${Date.now()}@example.com`;
    const password = 'stability-password-123';
    await postAuth(page, 'register', {
      fullName: 'Stability Tester',
      email,
      password,
      phone: '+1-555-0100',
    });
    await postAuth(page, 'login', { username: email, password });

    await page.goto('/customer');
    await expect(heading).toContainText('My Appointments');
    expect(await animatedAround(heading)).toEqual([]);

    await page.goto('/customer/book');
    await expect(heading).toContainText('Book an Appointment');
    expect(await animatedAround(heading)).toEqual([]);
  });
});
