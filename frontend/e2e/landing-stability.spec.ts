import { expect, test } from '@playwright/test';

/**
 * The guest landing's first paint is the prerendered HTML, so what the browser adds to it later
 * must neither move it nor hide it from Largest Contentful Paint (BENCHMARKS.md §72).
 */
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

    const animated = await hero.evaluate((header) =>
      [header, ...Array.from(header.querySelectorAll('*'))]
        .filter((element) => getComputedStyle(element).animationName !== 'none')
        .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
    );
    expect(animated).toEqual([]);
  });
});
