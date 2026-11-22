import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * A human click spans at least one rendered frame between press and release. When the press blurs
 * a field that validates on blur, its message renders in that frame and can move the button out
 * from under the pointer: the release lands beside it and no click fires (BENCHMARKS.md §74).
 * Playwright's own clicks are usually too fast to notice, so these tests press near the top edge,
 * let two frames render, then release.
 */
async function slowClickNearTop(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('the target is not rendered');
  await page.mouse.move(box.x + box.width / 2, box.y + 2);
  await page.mouse.down();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.mouse.up();
}

/** Waits until no finite CSS animation runs (the modal's opening animation moves its buttons). */
async function animationsSettled(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' ||
          animation.effect?.getComputedTiming().iterations === Infinity,
      ),
  );
}

test.describe('Clicks next to a field that validates on blur', () => {
  test('the login modal switches to registration', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    // The modal focuses the empty username field; leaving it shows "Username is required."
    await expect(page.locator('#username')).toBeFocused();
    await animationsSettled(page);

    await slowClickNearTop(page, page.locator('button:has-text("Need an account? Register")'));

    await expect(page.locator('#regName')).toBeVisible();
  });

  test('the booking wizard goes back from the contact step', async ({ page }) => {
    await page.goto('/');
    await page.click('.services-list .card:has-text("Classic Haircut")');
    await page.click('.wizard-footer-controls .btn-submit');
    await page.click('.card:has-text("Alex the Barber")');
    await page.click('.wizard-footer-controls .btn-submit');
    await page.locator('.form-group .slot-picker-btn').first().click();
    await page.locator('.time-slots-grid .slot-picker-btn:not(.slot-busy)').first().click();
    await page.click('.wizard-footer-controls .btn-submit');
    await expect(page.locator('.wizard-step-node.active')).toHaveText('4');
    // An empty contact field, focused: leaving it shows its "required" message above Back.
    await page.locator('#customerName').click();
    await animationsSettled(page);
    const back = page.locator('.wizard-back-btn');
    await back.scrollIntoViewIfNeeded();

    await slowClickNearTop(page, back);

    await expect(page.locator('.wizard-step-node.active')).toHaveText('3');
  });
});
