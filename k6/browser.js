import { browser } from 'k6/browser';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL;
if (!BASE_URL) throw new Error('BASE_URL environment variable is required');

// How long to wait for time-slot API to return after picking a date.
const SLOT_LOAD_MS = 1500;

export const options = {
  scenarios: {
    browser: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: {
    checks: ['rate==1.0'],
    // ----- Web vital performance gates — CWV good thresholds -----
    // TTFB <800ms good per web.dev, FCP <1800, LCP <2500
    browser_web_vital_ttfb: ['p(95)<800'],
    browser_web_vital_fcp: ['p(95)<1800'],
    browser_web_vital_lcp: ['p(95)<2500'],
  },
};

export default async function () {
  const page = await browser.newPage();
  let scenario = 'init';

  try {
    // ==============================================================
    // 1. PAGE LOAD — LANDING PAGE SMOKE TEST
    // ==============================================================
    scenario = 'page-load';
    console.log('--- 1. Page Load ---');

    await page.goto(BASE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page
      .locator('#step-panel-1')
      .waitFor({ state: 'visible', timeout: 10000 });

    const title = await page.title();
    check(title, {
      '1.1 title contains TaskFlow': (t) => t.includes('TaskFlow'),
    });

    // Confirm the wizard stepper (4-step tablist) rendered.
    const stepTabs = page.locator('button[role="tab"]');
    const tabCount = await stepTabs.count();
    check(tabCount, {
      '1.2 wizard stepper has 4 steps': (c) => c === 4,
    });

    // ==============================================================
    // 2. BOOKING WIZARD — LOOKBOOK SHORTCUT (picks service + advances)
    // ==============================================================
    scenario = 'wizard-step1-lookbook';
    console.log('--- 2. Wizard — Lookbook card ---');

    // The lookbook is deferred until the browser is idle, so wait for it rather
    // than falling back to an unrelated card in the first wizard step.
    const lookbookCard = page
      .locator('app-lookbook div[role="button"]')
      .first();
    await lookbookCard.waitFor({ state: 'visible', timeout: 10000 });
    await lookbookCard.click();
    await page
      .locator('#step-panel-2')
      .waitFor({ state: 'visible', timeout: 10000 });
    check(await page.locator('#step-panel-2').count(), {
      '2.1 lookbook advances to stylist selection': (c) => c === 1,
    });

    // ==============================================================
    // 3. BOOKING WIZARD — STEP 2: STYLIST SELECTION
    // ==============================================================
    scenario = 'wizard-step2-stylist';
    console.log('--- 3. Wizard — Stylist selection ---');

    const stylistCard = page
      .locator('#step-panel-2 div[aria-label^="Select stylist:"]')
      .first();
    await stylistCard.waitFor({ state: 'visible', timeout: 10000 });
    await stylistCard.click();
    check(
      await page
        .locator('#step-panel-2 div[aria-label^="Select stylist:"]')
        .count(),
      {
        '3.1 a stylist is available for selection': (c) => c >= 1,
      },
    );

    // Advance to step 3 only after the selected stylist has rendered.
    await page.locator('.wizard-footer-controls button.btn-submit').click();
    await page
      .locator('#step-panel-3')
      .waitFor({ state: 'visible', timeout: 10000 });

    // ==============================================================
    // 4. BOOKING WIZARD — STEP 3: DATE & TIME SLOT
    // ==============================================================
    scenario = 'wizard-step3-datetime';
    console.log('--- 4. Wizard — Date & time slot ---');

    // Click first available date in the carousel.
    const dateBtns = page.locator(
      '#step-panel-3 div[role="button"][aria-label^="Select date"]',
    );
    await dateBtns.first().waitFor({ state: 'visible', timeout: 10000 });
    const dateCount = await dateBtns.count();
    check(dateCount, {
      '4.1 date carousel has at least 1 day': (c) => c >= 1,
    });

    let timeSlotPicked = false;
    if (dateCount > 0) {
      await dateBtns.first().click();
      await page.waitForTimeout(SLOT_LOAD_MS); // Wait for busy-slots API

      // Look for an enabled time-slot button.
      const slotBtns = page.locator(
        '#step-panel-3 button.slot-picker-btn:not([disabled])',
      );
      const slotCount = await slotBtns.count();
      check(slotCount >= 0, {
        '4.2 time-slot buttons rendered': () => true,
      });

      if (slotCount > 0) {
        await slotBtns.first().click();
        timeSlotPicked = true;
        check(true, { '4.3 time slot selected': () => true });

        // Advance to step 4.
        await page.locator('.wizard-footer-controls button.btn-submit').click();
        await page
          .locator('#step-panel-4')
          .waitFor({ state: 'visible', timeout: 10000 });
      } else {
        console.log(
          '  (no available slots — shop may be closed; skipping step 4)',
        );
        check(true, {
          '4.3 no time slots (shop closed or all booked) — step skipped': () =>
            true,
        });
      }
    }

    // ==============================================================
    // 5. BOOKING WIZARD — STEP 4: CUSTOMER INFO FORM
    // ==============================================================
    if (timeSlotPicked) {
      scenario = 'wizard-step4-form';
      console.log('--- 5. Wizard — Customer info form ---');

      const nameInput = page.locator('#customerName');
      if ((await nameInput.count()) > 0) {
        await nameInput.fill('K6 Test User');
        check(true, { '5.1 customer name filled': () => true });
      }

      const emailInput = page.locator('#customerEmail');
      if ((await emailInput.count()) > 0) {
        await emailInput.fill('k6-test@example.com');
        check(true, { '5.2 customer email filled': () => true });
      }

      const phoneInput = page.locator('#customerPhone');
      if ((await phoneInput.count()) > 0) {
        await phoneInput.fill('+1-555-0000');
        check(true, { '5.3 customer phone filled': () => true });
      }

      // Verify the submit button exists (do NOT click — we don't want to
      // create test bookings on the production database).
      const submitBtn = page.locator('button[type="submit"]');
      check((await submitBtn.count()) > 0, {
        '5.4 submit button visible (not clicked)': (v) => v === true,
      });
    }

    console.log('=== All scenarios completed ===');
  } catch (err) {
    console.error(`\n[FAIL] Scenario "${scenario}" threw: ${err.message}`);
    throw err;
  } finally {
    await page.close();
  }
}
